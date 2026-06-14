import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import FarmerWeather from "./pages/FarmerWeather.tsx";
import FarmerAnalyze from "./pages/FarmerAnalyze.tsx";
import Welcome from "./pages/Welcome.tsx";
import Analytics from "./pages/Analytics.tsx";
import Gallery from "./pages/Gallery.tsx";
import Expert from "./pages/Expert.tsx";
import ExpertDesk from "./pages/ExpertDesk.tsx";
import AuthPage from "./pages/Auth.tsx";
import SettingsPage from "./pages/Settings.tsx";
import Fields from "./pages/Fields.tsx";
import Flights from "./pages/Flights.tsx";
import Drones from "./pages/Drones.tsx";
import Images from "./pages/Images.tsx";
import Segmentations from "./pages/Segmentations.tsx";
import LatestDetections from "./pages/LatestDetections.tsx";
import ChatBot from "./pages/Chatbot.tsx";
import Alerts from "./pages/Alerts.tsx";
import { useAgronomistLocation } from "@/hooks/useAgronomistLocation";
import { Layout } from "./components/Layout.tsx";
import { Logo } from "./components/Logo.tsx";
import Landing from "./pages/Landing.tsx";
import { useWebSocket, StressAlertMessage } from "./hooks/useWebSocket";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import "leaflet/dist/leaflet.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: 1000,
      staleTime: 0,
    },
  },
});

const ProtectedShell = ({
  wsUrl,
  setWsUrl,
  threshold,
  setThreshold,
  wsConnected,
  lastAlert,
  unreadAlerts,
  clearUnread,
}: {
  wsUrl: string;
  setWsUrl: (s: string) => void;
  threshold: number;
  setThreshold: (n: number) => void;
  wsConnected: boolean;
  lastAlert: StressAlertMessage | null;
  unreadAlerts: number;
  clearUnread: () => void;
}) => {
  const { user, role, loading } = useAuth();
  useAgronomistLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 app-shell-bg">
        <Logo size="lg" glow className="animate-pulse" />
        <p className="text-sm font-medium text-muted-foreground">Loading Phytospectra…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  const home = "/home";

  return (
    <Layout
      wsConnected={wsConnected}
      dbConnected={true}
      wsUrl={wsUrl}
      lastAlert={lastAlert}
      unreadAlerts={unreadAlerts}
      clearUnread={clearUnread}
    >
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/home" element={<Welcome />} />
        <Route path="/live" element={<Navigate to="/home" replace />} />
        <Route path="/dashboard" element={<Navigate to="/home" replace />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/expert" element={role === "agronomist" ? <Navigate to="/expert-desk" replace /> : <Expert />} />
        <Route path="/expert-desk" element={role === "agronomist" ? <ExpertDesk /> : <Navigate to="/analytics" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/farmer-weather" element={role === "farmer" ? <FarmerWeather /> : <Navigate to="/analytics" replace />} />
        <Route path="/farmer-analyze" element={role === "farmer" ? <FarmerAnalyze /> : <Navigate to="/analytics" replace />} />
        <Route path="/chat" element={<ChatBot />} />
        <Route path="/fields" element={<Fields />} />
        <Route path="/flights" element={<Flights />} />
        <Route path="/drones" element={<Drones />} />
        <Route path="/images" element={<Images />} />
        <Route path="/segmentations/:flight_id" element={<Segmentations />} />
        <Route path="/detections/latest" element={<LatestDetections />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
};

const App = () => {
  const [wsUrl, setWsUrl] = useState("");
  const [threshold, setThreshold] = useState(55);
  const { connected, lastAlert, unreadAlerts, clearUnread } = useWebSocket(wsUrl || null);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/" element={<Landing />} />
              <Route
                path="*"
                element={
                  <ProtectedShell
                    wsUrl={wsUrl}
                    setWsUrl={setWsUrl}
                    threshold={threshold}
                    setThreshold={setThreshold}
                    wsConnected={connected}
                    lastAlert={lastAlert}
                    unreadAlerts={unreadAlerts}
                    clearUnread={clearUnread}
                  />
                }
              />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;