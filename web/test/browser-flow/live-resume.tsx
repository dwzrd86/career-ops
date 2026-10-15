import { createRoot } from "react-dom/client";
import { ResumeStudio } from "../../src/ResumeStudio";
import { browserFlowState, createBrowserFlowJob } from "./browser-state";
import "../../src/styles.css";

createBrowserFlowJob({ company: "Fictional Analytics", title: "SQL Analyst",
  location: "Remote", source: "Synthetic verification", url: "https://example.test/sql-analyst" });
createRoot(document.getElementById("root")!).render(<ResumeStudio jobs={browserFlowState().jobs} />);
