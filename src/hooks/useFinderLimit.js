import { useEffect, useState } from 'react';

export function useFinderLimit(totalCount, resetDependencies = [], initialVisible = 25) {
    const [visibleCount, setVisibleCount] = useState(initialVisible);

    useEffect(() => {
        setVisibleCount(initialVisible);
    }, resetDependencies);

    useEffect(() => {
        if (totalCount === 0) {
            setVisibleCount(initialVisible);
            return;
        }

        if (visibleCount > totalCount) {
            setVisibleCount(totalCount);
        }
    }, [totalCount, visibleCount, initialVisible]);

    const showMore = () => {
        if (totalCount === 0) return;
        setVisibleCount(current => {
            const next = Math.max(initialVisible, current || initialVisible) * 2;
            return Math.min(totalCount, next);
        });
    };

    return {
        visibleCount: totalCount === 0 ? 0 : Math.min(visibleCount, totalCount),
        hasMore: totalCount > 0 && visibleCount < totalCount,
        showMore
    };
}

