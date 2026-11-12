/**
 * Bake a rotation sheet from a single projectile frame.
 *
 * Native missile records draw the sprite WA's way: `animation_phase` picks a
 * frame, so the art itself has to carry the rotation. WA's own `airmisl`
 * convention (and PX's `sprites/homing_air_strike/flight.png`) is a vertical
 * strip, top to bottom, frame 0 pointing up and turning clockwise over the
 * whole 360°. With `missile.animation = 2` the frame follows the flight
 * direction; with `1` the missile's spin walks the strip.
 *
 * The cell is padded to the rotating frame's bounding square (w×√2 for a
 * square source) so diagonal frames keep their corners; every cell is the
 * same size, which is what `frames` in mod.toml slices.
 *
 * Roaming animals use the same convention: WA picks the cell from the flight
 * heading (its own `spsheep1/2` and PX's Ghost Sheep `ghstshp1/2.png` are
 * 32 cells), so the baked strip goes straight into `sheep_sprites`.
 */
export interface RotationSheet {
  file: File;
  previewUrl: string;
  frames: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file could not be decoded as an image.'));
    image.src = url;
  });
}

function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The rotation sheet could not be encoded.'));
        return;
      }
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
}

export async function buildRotationSheet(
  source: File,
  frames: number
): Promise<RotationSheet> {
  const count = Math.max(2, Math.round(frames));
  const sourceUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(sourceUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('That image has no pixels.');

    // Worst-case bounding box of the rotating frame: the diagonal.
    const cell = Math.ceil(Math.hypot(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = cell;
    canvas.height = cell * count;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot build the sheet (no 2D canvas).');

    // Smoothing keeps thin diagonal edges of pixel art readable after WA's
    // palette mapping; the sheet is quantized at load either way.
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < count; i += 1) {
      ctx.save();
      ctx.translate(cell / 2, i * cell + cell / 2);
      // Screen space (y down): positive angles turn clockwise, so an art frame
      // pointing up walks up, right, down, left as WA's airmisl order does.
      ctx.rotate((i * Math.PI * 2) / count);
      ctx.drawImage(image, -width / 2, -height / 2);
      ctx.restore();
    }

    const stem = (source.name || 'sheet').replace(/\.[^.]+$/, '');
    const file = await canvasToFile(canvas, `${stem}_rot${count}.png`);
    return { file, previewUrl: URL.createObjectURL(file), frames: count };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
