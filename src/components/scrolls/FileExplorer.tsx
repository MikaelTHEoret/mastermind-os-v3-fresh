// Basic FileExplorer component to resolve build error
import React from 'react';

interface FileExplorerProps {
  files?: any[];
  onFileSelect?: (file: any) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ files = [], onFileSelect }) => {
  return (
    <div className="file-explorer">
      <h3>File Explorer</h3>
      {files.length === 0 ? (
        <p>No files found</p>
      ) : (
        <ul>
          {files.map((file, index) => (
            <li 
              key={index} 
              onClick={() => onFileSelect?.(file)}
              className="cursor-pointer hover:bg-gray-100 p-2"
            >
              {file.name || `File ${index + 1}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FileExplorer;