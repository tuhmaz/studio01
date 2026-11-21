/** Verkleinert ein Foto im Browser auf max. 1600 px (JPEG ~0,8), damit Uploads schnell gehen. */
export async function compressImage(file: File, maxSize = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<InstanceType<typeof window.Image>>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
