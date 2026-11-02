import api from "./api";

export const getProfessorStats = (period = "3m", courseId = "", config = {}) =>
  api
    .get("/api/attendance/stats/", {
      ...config,
      params: {
        period,
        ...(courseId ? { course_id: courseId } : {}),
      },
    })
    .then((response) => response.data);
