
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !isActive) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const barCount = 40;
    const bars = Array.from({ length: barCount }, () => Math.random());

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const barWidth = width / barCount;

      bars.forEach((val, i) => {
        const factor = isSpeaking ? 1.8 : (isActive ? 0.7 : 0.1);
        const speed = isSpeaking ? 150 : 300;
        const barHeight = (Math.sin(Date.now() / speed + i * 0.3) * 0.4 + 0.6) * height * 0.5 * factor;
        
        const x = i * barWidth;
        const y = (height - barHeight) / 2;

        ctx.shadowBlur = isSpeaking ? 15 : 5;
        ctx.shadowColor = '#2dd4bf';

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, '#2dd4bf'); // teal-400
        gradient.addColorStop(0.5, '#0ea5e9'); // sky-500
        gradient.addColorStop(1, '#3b82f6'); // blue-500

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x + 3, y, barWidth - 6, barHeight, 10);
        ctx.fill();
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, isSpeaking]);

  return (
    <div className="relative w-full h-32 flex items-center justify-center overflow-hidden">
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={128} 
        className="max-w-full"
      />
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
          انقر على الميكروفون للبدء
        </div>
      )}
    </div>
  );
};
