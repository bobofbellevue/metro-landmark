import { useState, useRef, useEffect } from 'react';
import SignaturePad from 'signature_pad';

/**
 * SignatureCapture component for capturing electronic signatures
 * 
 * Props:
 * - onSignature: Function (callback with base64 signature image)
 * - onCancel: Function (optional, callback when cancelled)
 * - width: Number (canvas width, default 400)
 * - height: Number (canvas height, default 200)
 */
export default function SignatureCapture({
  onSignature,
  onCancel,
  width = 400,
  height = 200
}) {
  const canvasRef = useRef(null);
  const signaturePadRef = useRef(null);
  const fileInputRef = useRef(null);
  const [signaturePad, setSignaturePad] = useState(null);
  const [error, setError] = useState('');
  const [signatureMethod, setSignatureMethod] = useState('draw'); // 'draw', 'type', 'upload'
  const [typedName, setTypedName] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (canvasRef.current && !signaturePad && signatureMethod === 'draw') {
      const sigPad = new SignaturePad(canvasRef.current, {
        backgroundColor: 'rgb(255, 255, 255)',
        penColor: 'rgb(0, 0, 0)'
      });
      setSignaturePad(sigPad);
      signaturePadRef.current = sigPad;
    }

    return () => {
      if (signaturePad) {
        signaturePad.clear();
      }
    };
  }, [signatureMethod]);

  const handleClear = () => {
    if (signaturePad) {
      signaturePad.clear();
    }
    setTypedName('');
    setUploadedImage(null);
    setPreview(null);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target.result;
      setUploadedImage(imageData);
      setPreview(imageData);
      setError('');
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const generateTypedSignature = () => {
    if (!typedName.trim()) {
      setError('Please enter your name');
      return null;
    }

    // Create a canvas to render the typed name as a signature
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Set background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // Draw signature text
    ctx.fillStyle = 'black';
    ctx.font = '48px "Brush Script MT", cursive, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName.trim(), width / 2, height / 2);

    return canvas.toDataURL('image/png');
  };

  const handleSave = () => {
    setError('');
    let signatureData = null;

    if (signatureMethod === 'draw') {
      if (!signaturePad || signaturePad.isEmpty()) {
        setError('Please provide a signature');
        return;
      }
      signatureData = signaturePad.toDataURL('image/png');
    } else if (signatureMethod === 'type') {
      signatureData = generateTypedSignature();
      if (!signatureData) return;
    } else if (signatureMethod === 'upload') {
      if (!uploadedImage) {
        setError('Please upload a signature image');
        return;
      }
      signatureData = uploadedImage;
    }

    if (signatureData) {
      setPreview(signatureData);
      onSignature?.(signatureData);
    }
  };

  const handleCancel = () => {
    if (signaturePad) {
      signaturePad.clear();
    }
    setTypedName('');
    setUploadedImage(null);
    setPreview(null);
    onCancel?.();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <h3 className="text-lg font-semibold mb-4">Sign Document</h3>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {error}
        </div>
      )}

      {/* Signature Method Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Signature Method
        </label>
        <div className="flex gap-4">
          <button
            onClick={() => {
              setSignatureMethod('draw');
              handleClear();
            }}
            className={`px-4 py-2 text-sm rounded ${
              signatureMethod === 'draw'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Draw
          </button>
          <button
            onClick={() => {
              setSignatureMethod('type');
              handleClear();
            }}
            className={`px-4 py-2 text-sm rounded ${
              signatureMethod === 'type'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Type Name
          </button>
          <button
            onClick={() => {
              setSignatureMethod('upload');
              handleClear();
            }}
            className={`px-4 py-2 text-sm rounded ${
              signatureMethod === 'upload'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Upload Image
          </button>
        </div>
      </div>

      {/* Drawing Canvas */}
      {signatureMethod === 'draw' && (
        <div className="border-2 border-gray-300 rounded-lg mb-4">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="w-full cursor-crosshair"
            style={{ touchAction: 'none' }}
          />
        </div>
      )}

      {/* Typed Name Input */}
      {signatureMethod === 'type' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enter your name
          </label>
          <input
            type="text"
            value={typedName}
            onChange={(e) => {
              setTypedName(e.target.value);
              setError('');
            }}
            placeholder="Your full name"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {typedName && (
            <div className="mt-4 border-2 border-gray-300 rounded-lg p-4 bg-gray-50">
              <p className="text-center text-3xl font-cursive" style={{ fontFamily: '"Brush Script MT", cursive' }}>
                {typedName}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload Image */}
      {signatureMethod === 'upload' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Signature Image
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {preview && (
            <div className="mt-4 border-2 border-gray-300 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-2">Preview:</p>
              <img
                src={preview}
                alt="Signature preview"
                className="max-w-full h-auto max-h-48 mx-auto"
              />
            </div>
          )}
        </div>
      )}

      {/* Preview for all methods */}
      {preview && signatureMethod !== 'upload' && (
        <div className="mb-4 border-2 border-gray-300 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-2">Preview:</p>
          <img
            src={preview}
            alt="Signature preview"
            className="max-w-full h-auto max-h-48 mx-auto"
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={handleClear}
          className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
        >
          Clear
        </button>
        <button
          onClick={handleCancel}
          className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded"
        >
          Sign
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-2 text-center">
        {signatureMethod === 'draw' && 'Draw your signature above'}
        {signatureMethod === 'type' && 'Type your name above'}
        {signatureMethod === 'upload' && 'Upload your signature image'}
      </p>
    </div>
  );
}

