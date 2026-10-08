import { useState, useEffect } from 'react';

export function useMobileViewport() {
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
    const [viewportHeight, setViewportHeight] = useState<number | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const vv = window.visualViewport;
        if (!vv) return;

        const initialHeight = window.innerHeight;

        const handleResize = () => {
            setViewportHeight(vv.height);
            // Keyboard is detected if visualViewport is noticeably smaller than window height
            const keyboardActive = vv.height < initialHeight * 0.78;
            setIsKeyboardOpen(keyboardActive);
        };

        vv.addEventListener('resize', handleResize);
        vv.addEventListener('scroll', handleResize);

        return () => {
            vv.removeEventListener('resize', handleResize);
            vv.removeEventListener('scroll', handleResize);
        };
    }, []);

    return { isKeyboardOpen, viewportHeight };
}
