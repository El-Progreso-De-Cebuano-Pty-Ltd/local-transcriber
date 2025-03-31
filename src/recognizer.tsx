import React, { useState, useEffect } from "react";
import styled from "styled-components";
import * as antd from "antd";  // Import all antd components
import { SaveOutlined, FileTextOutlined } from "@ant-design/icons";

import { createModel, KaldiRecognizer, Model } from "vosk-browser";
import Microphone from "./microphone";

const { Button, Modal, Input, Spin } = antd;  // Destructure the components

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

  // Generate a summary using API
  const generateSummary = async () => {
    try {
      setSummarizing(true);
      const transcript = getFullTranscript();
      
      if (!transcript || !transcript.trim()) {
        setSummary("No transcript content to summarize.");
        setSummarizing(false);
        return;
      }
      
      // You will need to provide your API key and endpoint
      const apiEndpoint = "https://api.openai.com/v1/chat/completions";
      const apiKey = "YOUR_API_KEY"; // Replace with your actual API key or use environment variable
      
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that summarizes text concisely."
            },
            {
              role: "user",
              content: `Please summarize the following transcript in 2-3 sentences: ${transcript}`
            }
          ],
          max_tokens: 150
        })
      });
      
      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        setSummary(data.choices[0].message.content.trim());
      } else {
        setSummary("Failed to generate summary. Please try again.");
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