import React, { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AdminLogin from "./pages/AdminLogin";
import AttendQR from "./pages/AttendQR";
import AdminLayout from "./components/AdminLayout";
import ProfLayout from "./components/ProfLayout";
import api from "./services/api";

function MainApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCurrentUser = (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError("");
    api
      .get("/api/auth/me/")
      .then((res) => setUser(res.data))
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          setUser(null);
        } else {
          setError("No se pudo conectar con el servidor.");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCurrentUser(true);
    // El interceptor de api.js avisa aquí cuando otra petición recibe 401.
    const onUnauthorized = () => setUser(null);
    window.addEventListener("siaqr:unauthorized", onUnauthorized);
    return () => window.removeEventListener("siaqr:unauthorized", onUnauthorized);
  }, []);

  const handleLogout = async () => {
    try {
      // api con withXSRFToken: el POST lleva X-CSRFToken (C1).
      await api.post("/api/auth/logout/");
    } catch {
      // Ignoramos error y limpiamos estado
    } finally {
      setUser(null);
      window.location.href = "/";
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center space-y-4 bg-gray-50 p-4 text-center">
        <p className="text-gray-700">{error}</p>
        <button
          onClick={() => fetchCurrentUser(true)}
          className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-lg text-sm font-medium transition-colors"
        >
          Reintentar
        </button>
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
    <div className="min-h-dvh flex flex-col items-center justify-center space-y-4 bg-gray-50 p-4 text-center">
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
        <Route
          path="/admin-login"
          element={<AdminLogin onSuccess={() => (window.location.href = "/")} />}
        />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
