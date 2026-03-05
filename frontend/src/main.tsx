import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./i18n";
import "./index.css";
import { Layout } from "./components/layout/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { CoursesPage } from "./pages/CoursesPage";
import { DocumentUploadPage } from "./pages/DocumentUploadPage";
import { HomeworkPage } from "./pages/HomeworkPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { QuizzesPage } from "./pages/QuizzesPage";
import { QuizDetailPage } from "./pages/QuizDetailPage";
import { ExamsPage } from "./pages/ExamsPage";
import { TranscriptsPage } from "./pages/TranscriptsPage";
import { ProgressPage } from "./pages/ProgressPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SchedulePage } from "./pages/SchedulePage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="documents/upload" element={<DocumentUploadPage />} />
          <Route path="homework" element={<HomeworkPage />} />
          <Route path="flashcards" element={<FlashcardsPage />} />
          <Route path="quizzes" element={<QuizzesPage />} />
          <Route path="quizzes/:id" element={<QuizDetailPage />} />
          <Route path="exams" element={<ExamsPage />} />
          <Route path="transcripts" element={<TranscriptsPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
