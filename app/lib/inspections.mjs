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
  const photoRefs = inspection?.photoRefs || inspection?.photos;
  return {
    findingCount: findings.length,
    photoCount:
      (Array.isArray(photoRefs) ? photoRefs.length : 0) +
      findings.reduce(
        (count, finding) => count + (Array.isArray(finding.photos) ? finding.photos.length : 0),
        0,
      ),
  };
}
