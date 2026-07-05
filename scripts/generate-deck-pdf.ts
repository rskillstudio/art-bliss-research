import { generateDeckPdf } from "../src/reports/generate-deck-pdf.js";

generateDeckPdf()
  .then((ok) => {
    if (!ok) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
