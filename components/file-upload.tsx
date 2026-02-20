import { useId, useState } from 'react';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Upload, FileText, Image, AlertCircle, CheckCircle } from 'lucide-react';
import { apiFetch, readErrorMessage, readJsonBody } from '../utils/api-client';

interface FileUploadProps<TResult = unknown> {
  endpoint: string;
  acceptedTypes: string[];
  maxSize: number;
  onUploadComplete: (_result: TResult) => void;
  onError: (_error: string) => void;
  title?: string;
  description?: string;
  multiple?: boolean;
  additionalFields?: { [key: string]: string };
}

interface UploadCallbacks<TResult = unknown> {
  onUploadComplete: (_result: TResult) => void;
  onError: (_error: string) => void;
}

export default function FileUpload<TResult = unknown>({ 
  endpoint, 
  acceptedTypes, 
  maxSize, 
  onUploadComplete, 
  onError,
  title = "Upload File",
  description = "Select a file to upload",
  multiple = false,
  additionalFields = {}
}: FileUploadProps<TResult>) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const validateFile = (file: File): string | null => {
    if (!acceptedTypes.includes(file.type)) {
      return `Invalid file type. Allowed: ${acceptedTypes.join(', ')}`;
    }

    if (file.size > maxSize) {
      return `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`;
    }

    return null;
  };

  const handleFileUpload = async (files: FileList) => {
    const file = files[0]; // For now, handle single file
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setUploadStatus('error');
      setStatusMessage(validationError);
      onError(validationError);
      return;
    }

    try {
      setUploading(true);
      setProgress(0);
      setUploadStatus('idle');

      const formData = new FormData();
      
      // Determine the field name based on endpoint
      let fieldName = 'file';
      if (endpoint.includes('/avatar')) fieldName = 'avatar';
      else if (endpoint.includes('/map')) fieldName = 'mapFile';
      else if (endpoint.includes('/assets')) fieldName = 'asset';
      
      formData.append(fieldName, file);
      
      // Add additional fields
      Object.keys(additionalFields).forEach(key => {
        formData.append(key, additionalFields[key]);
      });

      const response = await apiFetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      setProgress(100);

      if (!response.ok) {
        const message = await readErrorMessage(response, 'Upload failed');
        throw new Error(message);
      }

      const result = await readJsonBody<TResult>(response);
      setUploadStatus('success');
      setStatusMessage('File uploaded successfully!');
      onUploadComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      setUploadStatus('error');
      setStatusMessage(errorMessage);
      onError(errorMessage);
    } finally {
      setUploading(false);
      setTimeout(() => {
        setProgress(0);
        setUploadStatus('idle');
        setStatusMessage('');
      }, 3000);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return <Image className="w-8 h-8" />;
    if (fileType === 'application/json') return <FileText className="w-8 h-8" />;
    return <Upload className="w-8 h-8" />;
  };

  const getStatusIcon = () => {
    if (uploadStatus === 'success') return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (uploadStatus === 'error') return <AlertCircle className="w-4 h-4 text-red-500" />;
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive 
              ? 'border-primary bg-primary/10' 
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          } ${uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-12 h-12 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepted: {acceptedTypes.map(type => type.split('/')[1]).join(', ')} 
                • Max: {Math.round(maxSize / 1024 / 1024)}MB
              </p>
            </div>
          </div>
          
          <Input
            id={inputId}
            type="file"
            accept={acceptedTypes.join(',')}
            multiple={multiple}
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            className="hidden"
            disabled={uploading}
          />
        </div>

        {uploading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Uploading...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {uploadStatus !== 'idle' && statusMessage && (
          <Alert variant={uploadStatus === 'error' ? 'destructive' : 'default'}>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <AlertDescription>{statusMessage}</AlertDescription>
            </div>
          </Alert>
        )}

        <div className="text-xs text-muted-foreground">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <strong>Allowed file types:</strong>
              <ul className="mt-1 space-y-1">
                {acceptedTypes.map(type => (
                  <li key={type} className="flex items-center gap-1">
                    {getFileIcon(type)}
                    <span>{type}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Upload limits:</strong>
              <ul className="mt-1 space-y-1">
                <li>Max size: {Math.round(maxSize / 1024 / 1024)}MB</li>
                <li>Files: {multiple ? 'Multiple' : 'Single'}</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Convenience components for common upload types
interface AvatarUploadProps extends UploadCallbacks {
  userId?: string;
}

export function AvatarUpload({ onUploadComplete, onError, userId }: AvatarUploadProps) {
  return (
    <FileUpload
      endpoint="/api/upload/avatar"
      acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
      maxSize={5 * 1024 * 1024} // 5MB
      onUploadComplete={onUploadComplete}
      onError={onError}
      title="Upload Avatar"
      description="Upload a profile picture or character avatar"
      additionalFields={userId ? { user_id: userId } : {}}
    />
  );
}

interface MapUploadProps extends UploadCallbacks {
  uploadedBy: string;
}

export function MapUpload({ onUploadComplete, onError, uploadedBy }: MapUploadProps) {
  return (
    <FileUpload
      endpoint="/api/upload/map"
      acceptedTypes={['application/json', 'image/jpeg', 'image/png']}
      maxSize={50 * 1024 * 1024} // 50MB
      onUploadComplete={onUploadComplete}
      onError={onError}
      title="Upload World Map"
      description="Upload Azgaar's FMG file or map image"
      additionalFields={{ uploaded_by: uploadedBy }}
    />
  );
}

interface CampaignAssetUploadProps extends UploadCallbacks {
  campaignId: string;
}

export function CampaignAssetUpload({ campaignId, onUploadComplete, onError }: CampaignAssetUploadProps) {
  return (
    <FileUpload
      endpoint={`/api/campaigns/${campaignId}/assets`}
      acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'application/pdf']}
      maxSize={25 * 1024 * 1024} // 25MB
      onUploadComplete={onUploadComplete}
      onError={onError}
      title="Upload Campaign Asset"
      description="Upload images, maps, or documents for this campaign"
      multiple={false}
    />
  );
}
