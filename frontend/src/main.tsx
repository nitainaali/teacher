import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./i18n";
import "./index.css";
import { GenerationProvider } from "./context/GenerationContext";
import { AppLayout, PlainPageLayout } from "./components/layout/AppLayout";
import { CourseLayout } from "./components/layout/CourseLayout";
import { WelcomePage } from "./pages/WelcomePage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LearningPage } from "./pages/LearningPage";
import { TopicSummaryPage } from "./pages/TopicSummaryPage";
import { FlashcardsPage } from "./pages/FlashcardsPage";
import { QuizzesPage } from "./pages/QuizzesPage";
import { QuizDetailPage } from "./pages/QuizDetailPage";
import { UnifiedChatPage } from "./pages/UnifiedChatPage";
import { DiagnosisPage } from "./pages/DiagnosisPage";
import { SettingsPage } from "./pages/SettingsPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GenerationProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Welcome / no-course state */}
          <Route index element={<PlainPageLayout><WelcomePage /></PlainPageLayout>} />

          {/* Per-course routes */}
          <Route path="course/:courseId" element={<CourseLayout />}>
            <Route index element={<Navigate to="knowledge" replace />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="learning" element={<LearningPage />} />
            <Route path="learning/summary" element={<TopicSummaryPage />} />
            <Route path="learning/flashcards" element={<FlashcardsPage />} />
            <Route path="learning/quizzes" element={<QuizzesPage />} />
            <Route path="learning/quizzes/:id" element={<QuizDetailPage />} />
            <Route path="chat" element={<UnifiedChatPage />} />
            {/* Redirect old homework/exam URLs to the unified chat page */}
            <Route path="homework" element={<Navigate to="../chat" replace />} />
            <Route path="exam" element={<Navigate to="../chat" replace />} />
            <Route path="diagnosis" element={<DiagnosisPage />} />
          </Route>

          {/* Settings (not course-specific) */}
          <Route
            path="settings"
            element={
              <PlainPageLayout>
                <SettingsPage />
              </PlainPageLayout>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
    </GenerationProvider>
  </React.StrictMode>
);
