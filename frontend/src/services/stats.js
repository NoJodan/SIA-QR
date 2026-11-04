import api from "./api";

export const getStats = ({ period = "3m", courseId = "", professorId = "" } = {}, config = {}) =>
  api
    .get("/api/attendance/stats/", {
      ...config,
      params: {
        period,
        ...(courseId ? { course_id: courseId } : {}),
        ...(professorId ? { professor_id: professorId } : {}),
      },
    })
    .then((response) => response.data);
