import { useEffect, useState } from 'react';
import { extractSavedQrImage } from '../../utils/qrImage.mjs';

export function SavedQrPreview({ source }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    extractSavedQrImage(source).then(
      (image) => { if (!cancelled) setResult({ source, attempt, image }); },
      () => { if (!cancelled) setResult({ source, attempt, error: true }); }
    );
    return () => { cancelled = true; };
  }, [source, attempt]);

  if (result?.source !== source || result?.attempt !== attempt) {
    return <p role="status">Đang tách mã QR...</p>;
  }

  return <>
    <img src={result.image || source} alt="Mã QR" />
    {result.error && <>
      <p role="alert">Chưa thể tự tách mã QR. Đang hiển thị ảnh gốc.</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button>
    </>}
  </>;
}
