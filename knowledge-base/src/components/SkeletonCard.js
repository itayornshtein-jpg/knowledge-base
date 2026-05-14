import React from 'react';

function SkeletonCard() {
  return (
    <div className="entry-card card skeleton-card" aria-hidden="true">
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-meta" />
      <div className="skeleton-line skeleton-snippet" />
    </div>
  );
}

export default SkeletonCard;
