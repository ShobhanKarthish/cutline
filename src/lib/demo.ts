let sampleFiles: Promise<File[]> | undefined;

function paper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  page: string,
) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.translate(x + w * 0.1, y + h * 0.085);
  const width = w * 0.8;
  ctx.fillStyle = "#242424";
  ctx.font = `${Math.round(w * 0.014)}px sans-serif`;
  ctx.fillText("THE EVERYDAY ARCHIVE", 0, 0);
  ctx.textAlign = "right";
  ctx.fillText("FIELD NOTES  /  2026", width, 0);
  ctx.textAlign = "left";
  ctx.fillRect(0, 20, width, 2);
  ctx.font = `${Math.round(w * 0.078)}px Georgia`;
  ctx.fillText(title, 0, h * 0.125);
  ctx.font = `italic ${Math.round(w * 0.029)}px Georgia`;
  ctx.fillText(subtitle, 0, h * 0.17);
  const lines = [
    "There is a particular pleasure in putting things in order.",
    "Not to make them perfect, but to make room for what",
    "matters. A page saved. A small detail kept. A story that",
    "would otherwise have slipped between the shelves.",
    "",
    "We collect more than we know. Notes from a journey,",
    "a folded letter, the diagram on the back of a receipt.",
    "Over time these ordinary objects become a record of",
    "where we have been and what we chose to notice.",
    "",
    "An archive is not the end of a thing. It is a way of",
    "leaving the door open, so someone can return to it.",
  ];
  ctx.font = `${Math.round(w * 0.024)}px Georgia`;
  lines.forEach((line, i) => ctx.fillText(line, 0, h * 0.255 + i * h * 0.029));
  ctx.strokeStyle = "#353535";
  ctx.lineWidth = 1.5;
  const baseY = h * 0.7;
  for (let i = 0; i < 4; i++) {
    ctx.strokeRect((i * width) / 4, baseY, width / 4 - 12, h * 0.095);
  }
  ctx.font = `${Math.round(w * 0.013)}px sans-serif`;
  ["COLLECT", "ARRANGE", "PRESERVE", "RETURN"].forEach((text, i) =>
    ctx.fillText(text, (i * width) / 4 + 8, baseY + h * 0.115),
  );
  ctx.fillStyle = "#777";
  ctx.font = `${Math.round(w * 0.014)}px sans-serif`;
  ctx.fillText("ILLUSTRATIVE SAMPLE — GENERATED ON YOUR DEVICE", 0, h * 0.85);
  ctx.textAlign = "right";
  ctx.fillText(page, width, h * 0.85);
  ctx.restore();
}

export function createDemoFiles(): Promise<File[]> {
  sampleFiles ??= Promise.all(
    [0, 1, 2].map(async (i) => {
      const c = document.createElement("canvas");
      c.width = i === 1 ? 2400 : 1400;
      c.height = i === 1 ? 1700 : 1900;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#d8d8d6";
      ctx.fillRect(0, 0, c.width, c.height);
      if (i === 1) {
        paper(
          ctx,
          80,
          110,
          1100,
          1480,
          "Small details.",
          "A practice of paying attention.",
          "02",
        );
        paper(
          ctx,
          1200,
          65,
          1100,
          1480,
          "Worth keeping.",
          "A place for the ordinary.",
          "03",
        );
      } else {
        paper(
          ctx,
          i === 0 ? 130 : 55,
          i === 0 ? 90 : 180,
          1140,
          1580,
          i === 0 ? "On keeping things." : "Begin again.",
          "Notes on a slower kind of order.",
          i === 0 ? "01" : "04",
        );
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not create sample scan.")),
          "image/png",
        ),
      );
      c.width = c.height = 0;
      return new File(
        [blob],
        i === 1 ? "sample-spread.png" : `sample-page-${i + 1}.png`,
        { type: "image/png", lastModified: 1 },
      );
    }),
  );
  return sampleFiles;
}
