import React, { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AttendQR from "./pages/AttendQR";
import AdminLayout from "./components/AdminLayout";
import ProfLayout from "./components/ProfLayout";
import api, { API_BASE } from "./services/api";

function MainApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = () => {
    api
      .get("/api/auth/me/")
      .then((res) => {
        setUser(res.data);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const handleLogout = async () => {
    try {
      // api con withXSRFToken: el POST lleva X-CSRFToken (C1).
      await api.post("/api/auth/logout/");
    } catch (e) {
      // Ignoramos error y limpiamos estado
      void API_BASE;
    } finally {
      setUser(null);
      window.location.href = "/";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (user.role === "ROLE_ADMIN") {
    return <AdminLayout user={user} onLogout={handleLogout} />;
  }

  if (user.role === "ROLE_PROFESSOR") {
    return <ProfLayout user={user} onLogout={handleLogout} onRefreshUser={fetchCurrentUser} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center space-y-4 bg-gray-50">
      <h1 className="text-3xl font-bold text-gray-800">SIA-QR</h1>
      <p className="text-gray-600">Bienvenido, {user.email} ({user.role})</p>
      <button
        onClick={handleLogout}
        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
      >
        Cerrar Sesión
      </button>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta pública del estudiante: escaneo QR -> resolve -> login -> marcar */}
        <Route path="/attend" element={<AttendQR />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
