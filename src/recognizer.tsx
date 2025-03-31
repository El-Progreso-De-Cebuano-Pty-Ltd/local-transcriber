import React, { useState, useEffect } from "react";
import styled from "styled-components";
import * as antd from "antd";  // Import all antd components
import { SaveOutlined, FileTextOutlined } from "@ant-design/icons";
// Import only what we need from transformers
import { env, pipeline, TextClassificationPipeline } from '@xenova/transformers';

import { createModel, KaldiRecognizer, Model } from "vosk-browser";
import Microphone from "./microphone";

const { Button, Modal, Input, Spin } = antd;  // Destructure the components

// Configure transformers.js to use smaller/faster models
env.allowLocalModels = false;  // Disallow local models to avoid confusion
env.useBrowserCache = true;   // Enable caching for faster subsequent loads

const Wrapper = styled.div`
  width: 80%;
  text-align: left;
  max-width: 700px;
  margin: auto;
  display: flex;
  justify-content: center;
  flex-direction: column;
`;

const Header = styled.div`
  display: flex;
  justify-content: center;
  margin: 1rem auto;
`;

const ResultContainer = styled.div`
  width: 100%;
  margin: 1rem auto;
  border: 1px solid #aaaaaa;
  padding: 1rem;
  resize: vertical;
  overflow: auto;
`;

const Word = styled.span<{ confidence: number }>`
  color: ${({ confidence }) => {
    const color = Math.max(255 * (1 - confidence) - 20, 0);
    return `rgb(${color},${color},${color})`;
  }};
  white-space: normal;
`;

// For saving to a file
const downloadTextAsFile = (text: string, filename: string) => {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface VoskResult {
  result: Array<{
    conf: number;
    start: number;
    end: number;
    word: string;
  }>;
  text: string;
}

export const Recognizer: React.FunctionComponent = () => {
  const [utterances, setUtterances] = useState<VoskResult[]>([]);
  const [partial, setPartial] = useState("");
  const [loadedModel, setLoadedModel] = useState<{
    model: Model;
    path: string;
  }>();
  const [recognizer, setRecognizer] = useState<KaldiRecognizer>();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [fileName, setFileName] = useState("transcription");
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [summary, setSummary] = useState("");
  const [llmStatus, setLlmStatus] = useState("");
  const [textClassifier, setTextClassifier] = useState<TextClassificationPipeline | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);

  // Load the speech recognition model
  const loadModel = async (path: string) => {
    setLoading(true);
    loadedModel?.model.terminate();

    // Fix for process.env is not defined
    const PUBLIC_URL = window.location.origin + '/vosk-browser';
    const model = await createModel(PUBLIC_URL + "/models/" + path);

    setLoadedModel({ model, path });
    const recognizer = new model.KaldiRecognizer(48000);
    recognizer.setWords(true);
    recognizer.on("result", (message: any) => {
      const result: VoskResult = message.result;
      setUtterances((utt: VoskResult[]) => [...utt, result]);
    });

    recognizer.on("partialresult", (message: any) => {
      setPartial(message.result.partial);
    });

    setRecognizer(() => {
      setLoading(false);
      setReady(true);
      return recognizer;
    });
  };

  // Auto-load English model on component mount
  useEffect(() => {
    // English model path
    const englishModelPath = "vosk-model-small-en-us-0.15.tar.gz";
    loadModel(englishModelPath);
  }, []);

  // Lazy-load the text classification model only when needed
  const loadTextClassifier = async () => {
    if (textClassifier) return textClassifier;
    
    setLlmLoading(true);
    setLlmStatus("Loading text analysis model...");
    
    try {
      // Use a tiny sentiment analysis model - much smaller and faster than summarization models
      const classifier = await pipeline(
        'sentiment-analysis',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
      );
      
      setTextClassifier(classifier);
      setLlmStatus("Text analysis model loaded");
      setLlmLoading(false);
      return classifier;
    } catch (error) {
      console.error("Error loading text classifier:", error);
      setLlmStatus("Failed to load text analysis model");
      setLlmLoading(false);
      return null;
    }
  };

  // Get all text from utterances
  const getFullTranscript = () => {
    if (!utterances || utterances.length === 0) {
      return "";
    }
    
    return utterances
      .map((utt) => {
        if (!utt || !utt.result || !Array.isArray(utt.result)) {
          return "";
        }
        return utt.result
          .map((word) => word?.word || "")
          .filter(Boolean)
          .join(" ");
      })
      .filter(Boolean)
      .join(" ");
  };

  // Save transcript to a file
  const handleSave = () => {
    try {
      const transcript = getFullTranscript();
      if (transcript && transcript.trim()) {
        downloadTextAsFile(transcript, `${fileName}.txt`);
        setSaveModalVisible(false);
      } else {
        console.warn("No transcript content to save");
      }
    } catch (error) {
      console.error("Error saving transcript:", error);
    }
  };

  // Break text into sentences
  const getSentences = (text: string): string[] => {
    return text
      .replace(/([.?!])\s*(?=[A-Z])/g, "$1|")
      .split("|")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 5);
  };

  // Get the most important sentences
  const getImportantSentences = (sentences: string[], count = 3): string[] => {
    if (sentences.length <= count) return sentences;
    
    // Simple heuristic - get first, middle and last sentence
    const result = [sentences[0]];
    
    if (count >= 2) {
      result.push(sentences[Math.floor(sentences.length / 2)]);
    }
    
    if (count >= 3) {
      result.push(sentences[sentences.length - 1]);
    }
    
    return result;
  };

  // Explicitly define types for our sentiment analysis results
  interface SentimentResult {
    sentence: string;
    score: number;
    sentiment: string;
  }

  // Generate a summary
  const generateSummary = async () => {
    setSummarizing(true);
    try {
      const transcript = getFullTranscript();
      
      if (!transcript || !transcript.trim()) {
        setSummary("No transcript content to summarize.");
        return;
      }
      
      // Break into sentences
      const sentences = getSentences(transcript);
      
      if (sentences.length === 0) {
        setSummary("The transcript is too short to summarize effectively.");
        return;
      }
      
      if (sentences.length <= 3) {
        setSummary(transcript);
        return;
      }
      
      try {
        // Load the classifier if not already loaded
        const classifier = await loadTextClassifier();
        
        if (classifier) {
          // Use sentiment analysis to enhance our extractive summary
          const results = await Promise.all(
            sentences.map(async (sentence: string): Promise<SentimentResult> => {
              try {
                const sentiment = await classifier(sentence);
                // Handle different output formats from different models
                const result = sentiment[0];
                // Access properties safely with optional chaining
                return { 
                  sentence, 
                  score: (result as any)?.score || (result as any)?.confidence || 0.5,
                  sentiment: (result as any)?.label || 'NEUTRAL'
                };
              } catch (e) {
                return { sentence, score: 0.5, sentiment: 'NEUTRAL' };
              }
            })
          );
          
          // Find sentences with strongest sentiment (most interesting)
          const sortedResults = [...results].sort((a, b) => b.score - a.score);
          const topSentences = sortedResults.slice(0, 3).map(r => r.sentence);
          
          // Make sure to include the first sentence for context
          if (!topSentences.includes(sentences[0])) {
            topSentences[topSentences.length - 1] = sentences[0];
          }
          
          // Sort back into document order
          const orderedSentences = topSentences.sort((a, b) => 
            sentences.indexOf(a) - sentences.indexOf(b)
          );
          
          setSummary(orderedSentences.join(" "));
        } else {
          // Fallback to simple extractive summarization
          const importantSentences = getImportantSentences(sentences);
          setSummary(importantSentences.join(" "));
        }
      } catch (error) {
        console.error("Error in sentiment analysis:", error);
        // Fallback to simple extractive summarization
        const importantSentences = getImportantSentences(sentences);
        setSummary(importantSentences.join(" "));
      }
    } catch (error) {
      console.error("Error generating summary:", error);
      setSummary("An error occurred while generating the summary.");
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Wrapper>
      {loading && <div style={{ textAlign: 'center', margin: '1rem 0' }}>Loading English model...</div>}
      {llmLoading && <div style={{ textAlign: 'center', margin: '0.5rem 0', fontSize: '12px', color: '#666' }}>{llmStatus}</div>}
      <Header>
        <Microphone recognizer={recognizer} loading={loading} ready={ready} />
        <Button 
          icon={<SaveOutlined />} 
          style={{ marginLeft: '10px' }}
          disabled={!utterances.length}
          onClick={() => setSaveModalVisible(true)}
        >
          Save
        </Button>
        <Button 
          icon={<FileTextOutlined />} 
          style={{ marginLeft: '10px' }}
          disabled={!utterances.length}
          onClick={() => {
            setSummaryModalVisible(true);
            generateSummary();
          }}
        >
          Summarize
        </Button>
      </Header>
      <ResultContainer>
        {utterances.map((utt, uindex) =>
          utt?.result?.map((word, windex) => (
            <Word
              key={`${uindex}-${windex}`}
              confidence={word.conf}
              title={`Confidence: ${(word.conf * 100).toFixed(2)}%`}
            >
              {word.word}{" "}
            </Word>
          ))
        )}
        <span key="partial">{partial}</span>
      </ResultContainer>

      {/* Save Modal */}
      <Modal
        title="Save Transcript"
        open={saveModalVisible}
        onOk={handleSave}
        onCancel={() => setSaveModalVisible(false)}
      >
        <p>Enter a name for your transcript file:</p>
        <Input
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="transcript"
          suffix=".txt"
        />
      </Modal>

      {/* Summary Modal */}
      <Modal
        title="Transcript Summary"
        open={summaryModalVisible}
        onOk={() => setSummaryModalVisible(false)}
        onCancel={() => setSummaryModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setSummaryModalVisible(false)}>
            Close
          </Button>
        ]}
      >
        {summarizing ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin size="large" />
            <p style={{ marginTop: '10px' }}>Generating summary...</p>
            {llmLoading && <p style={{ fontSize: '12px', color: '#666' }}>{llmStatus}</p>}
          </div>
        ) : (
          <div>
            <p><strong>Summary:</strong></p>
            <p>{summary}</p>
          </div>
        )}
      </Modal>
    </Wrapper>
  );
};