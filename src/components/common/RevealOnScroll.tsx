import React, { useEffect, useRef, useState } from 'react';

interface RevealOnScrollProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  immediate?: boolean;
}

export const RevealOnScroll: React.FC<RevealOnScrollProps> = ({
  title,
  children,
  className = '',
  immediate = false,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState<boolean>(() => {
    if (immediate) return true;
    if (typeof window !== 'undefined') {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }
    return false;
  });

  useEffect(() => {
    if (revealed) return;
    const node = ref.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.96) {
      setRevealed(true);
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        threshold: 0.06,
        rootMargin: '0px 0px -36px 0px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <section
      ref={ref}
      data-section-title={title}
      className={`transition-[opacity,transform] duration-500 ease-out will-change-[opacity,transform] ${
        revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${className}`}
    >
      {children}
    </section>
  );
};
