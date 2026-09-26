import React, { useEffect, useState } from "react";
import Login from "./pages/Login";
import AdminLayout from "./components/AdminLayout";
import ProfLayout from "./components/ProfLayout";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = () => {
    fetch("http://localhost:8000/api/auth/me/", {
      credentials: "include",
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("No autenticado");
      })
      .then((data) => {
        setUser(data);
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
      await fetch("http://localhost:8000/api/auth/logout/", {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      // Ignoramos error y limpiamos estado
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

export default App;

