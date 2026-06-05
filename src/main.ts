import { createProposalApp } from "./ui/proposalApp.js";
import "./ui/styles.css";

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("ScopeForge UI root element was not found.");
}

createProposalApp(root);
