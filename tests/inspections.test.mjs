import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectionSummary,
  VEHICLE_INSPECTION_FINDINGS,
  VEHICLE_INSPECTION_PARTS,
} from "../app/lib/inspections.mjs";

test("inspection catalogs include all required vehicle areas and defect types", () => {
  assert.ok(VEHICLE_INSPECTION_PARTS.includes("Передний бампер"));
  assert.ok(VEHICLE_INSPECTION_PARTS.includes("Сиденья"));
  assert.ok(VEHICLE_INSPECTION_PARTS.includes("Панель приборов"));
  assert.ok(VEHICLE_INSPECTION_FINDINGS.includes("Царапина"));
  assert.ok(VEHICLE_INSPECTION_FINDINGS.includes("Загрязнение"));
});

test("inspection summary handles findings and optional photo references", () => {
  assert.deepEqual(inspectionSummary({
    findings: [
      { part: "Капот", photos: ["drive-file-1", "drive-file-2"] },
      { part: "Салон" },
    ],
  }), { findingCount: 2, photoCount: 2 });
  assert.deepEqual(inspectionSummary(null), { findingCount: 0, photoCount: 0 });
});
