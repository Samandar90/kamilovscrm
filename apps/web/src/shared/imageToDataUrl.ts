/**
 * Файл картинки → data-URL PNG, ужатый до maxSize по большей стороне.
 * Для логотипов клиник: хранится в clinics.logo_url, печатается на чеках,
 * поэтому размер ограничиваем (штатно выходит 10–80KB).
 */
export const imageFileToDataUrl = (file: File, maxSize = 256): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error("Выберите картинку PNG, JPEG или WebP"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Файл слишком большой (макс 5MB)"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas недоступен"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Не удалось обработать картинку"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать картинку"));
    };
    img.src = url;
  });
