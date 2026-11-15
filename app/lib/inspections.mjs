export const VEHICLE_INSPECTION_PARTS = [
  "Передний бампер",
  "Задний бампер",
  "Капот",
  "Крыша",
  "Левая сторона",
  "Правая сторона",
  "Крылья",
  "Стёкла",
  "Салон",
  "Сиденья",
  "Панель приборов",
  "Другое",
];

export const VEHICLE_INSPECTION_FINDINGS = [
  "Царапина",
  "Вмятина",
  "Потёртость",
  "Повреждение",
  "Загрязнение",
  "Другое",
];

export function inspectionSummary(inspection) {
  const findings = inspection?.findings || [];
  return {
    findingCount: findings.length,
    photoCount: findings.reduce(
      (count, finding) => count + (finding.photos || []).length,
      0,
    ),
  };
}

