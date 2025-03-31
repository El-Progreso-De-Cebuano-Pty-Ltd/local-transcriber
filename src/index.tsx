import "antd/dist/antd.min.css";

import React from "react";
import ReactDOM from "react-dom";
import styled from "styled-components";

import "./index.css";

import { Recognizer } from "./recognizer";

const Wrapper = styled.div`
  text-align: center;
  margin: auto;
  justify-content: center;
`;

ReactDOM.render(
  <React.StrictMode>
    <Wrapper>
      <h1>Local Transcriber</h1>
     
     
      <Recognizer />
      
     
    </Wrapper>
  </React.StrictMode>,
  document.getElementById("root")
);
