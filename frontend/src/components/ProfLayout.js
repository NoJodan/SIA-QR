import React, { useState } from "react";
import ProfSidebar from "./ProfSidebar";
import ClaseDetalle from "../pages/ClaseDetalle";
import CursoDetalle from "../pages/CursoDetalle";
import MisCursos from "../pages/MisCursos";
import ProfConfiguraciones from "../pages/ProfConfiguraciones";
import Reportes from "../pages/Reportes";

export default function ProfLayout({ user, onLogout, onRefreshUser }) {
  const [activeTab, setActiveTab] = useState("mis-cursos");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedInitialSession, setSelectedInitialSession] = useState(null);

  const selectGroup = (group) => {
    setSelectedGroup(group);
    setSelectedClass(null);
    setSelectedInitialSession(null);
    setActiveTab("curso-detalle");
  };

  const selectClass = (classItem, initialSession = null) => {
    setSelectedClass(classItem);
    // Sesión B3 con attend_url mostrable (clase inmediata): se hidrata en
    // ClaseDetalle antes del primer ensure para evitar el aviso fantasma de
    // "otro dispositivo". Se valida attend_url + expiración al recibir.
    const valid =
      initialSession?.session_id && initialSession?.attend_url ? initialSession : null;
    setSelectedInitialSession(valid);
    setActiveTab("clase-detalle");
  };

  const goToGroups = () => {
    setSelectedGroup(null);
    setSelectedClass(null);
    setSelectedInitialSession(null);
    setActiveTab("mis-cursos");
  };

  const goToGroupDetail = () => {
    setSelectedClass(null);
    setSelectedInitialSession(null);
    setActiveTab("curso-detalle");
  };

  const handleSelectTab = (tab) => {
    if (tab === "curso-detalle" && !selectedGroup) return;
    if (tab === "mis-cursos") {
      goToGroups();
      return;
    }
    if (tab === "configuraciones" || tab === "reportes") {
      setSelectedClass(null);
      setSelectedInitialSession(null);
    }
    setActiveTab(tab);
  };

  const isClassDetail = activeTab === "clase-detalle";

  return (
    <div className="fixed inset-0 flex h-dvh flex-col overflow-hidden bg-gray-100 md:flex-row">
      <ProfSidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main
        className={isClassDetail
          ? "min-h-0 min-w-0 w-full max-w-7xl flex-1 overflow-y-auto p-4 pb-24 mx-auto md:p-8 md:pb-8"
          : "min-h-0 min-w-0 w-full max-w-5xl flex-1 overflow-y-auto p-4 pb-24 mx-auto md:p-8 md:pb-8"}
      >
        {activeTab === "mis-cursos" && <MisCursos onSelectGroup={selectGroup} />}
        {activeTab === "curso-detalle" && selectedGroup && (
          <CursoDetalle group={selectedGroup} onBack={goToGroups} onSelectClass={selectClass} />
        )}
        {activeTab === "clase-detalle" && selectedGroup && selectedClass && (
          <ClaseDetalle
            key={selectedClass.id}
            group={selectedGroup}
            classItem={selectedClass}
            initialSession={selectedInitialSession}
            onBack={goToGroupDetail}
          />
        )}
        {activeTab === "configuraciones" && (
          <ProfConfiguraciones key={user?.employee_code} user={user} onSaved={onRefreshUser} />
        )}
        {activeTab === "reportes" && <Reportes isAdmin={false} />}
      </main>
    </div>
  );
}
