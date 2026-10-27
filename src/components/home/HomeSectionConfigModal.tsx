/**
 * Component: Home Section Configuration Modal
 * Documentation: documentation/features/home-sections.md
 *
 * Allows users to add/remove/reorder home page sections (Audible categories and sub-categories).
 * Drag-and-drop on desktop, up/down arrows on mobile. Auto-save with debounce.
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  XMarkIcon,
  PlusIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline';
import type { HomeSection, AudibleCategory } from '@/lib/hooks/useHomeSections';
import { authenticatedFetcher } from '@/lib/utils/api';
import { CategoryPicker } from './CategoryPicker';

const MAX_SECTIONS = 10;

const SECTION_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-orange-500', 'bg-teal-500',
];

function getSectionLabel(section: { sectionType: string; categoryName?: string | null }) {
  if (section.sectionType === 'popular') return 'Popular Audiobooks';
  if (section.sectionType === 'new_releases') return 'New Releases';
  return section.categoryName || 'Category';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sections: HomeSection[];
  onSave: (sections: Omit<HomeSection, 'id'>[]) => Promise<unknown>;
}

export function HomeSectionConfigModal({ isOpen, onClose, sections, onSave }: Props) {
  const [localSections, setLocalSections] = useState<Omit<HomeSection, 'id'>[]>([]);
  const [categories, setCategories] = useState<AudibleCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Sync from prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSections(
        sections.map((s) => ({
          sectionType: s.sectionType,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          sortOrder: s.sortOrder,
        }))
      );
      setDirty(false);
      setShowCategoryPicker(false);
    }
  }, [isOpen, sections]);

  // Auto-save with debounce
  useEffect(() => {
    if (!dirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await onSave(localSections.map((s, i) => ({ ...s, sortOrder: i })));
      } catch {
        // Silently fail — user will see stale state
      }
      setSaving(false);
      setDirty(false);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [dirty, localSections, onSave]);

  // Fetch categories when picker opens
  const loadCategories = useCallback(async () => {
    if (categories.length > 0) {
      setShowCategoryPicker(true);
      return;
    }
    setLoadingCategories(true);
    try {
      const data = await authenticatedFetcher('/api/audible/categories');
      setCategories(data.categories || []);
    } catch {
      setCategories([]);
    }
    setLoadingCategories(false);
    setShowCategoryPicker(true);
  }, [categories.length]);

  const addCategory = useCallback(
    (cat: { id: string; name: string }) => {
      if (localSections.length >= MAX_SECTIONS) return;
      // Prevent duplicate
      if (localSections.some((s) => s.sectionType === 'category' && s.categoryId === cat.id)) return;

      setLocalSections((prev) => [
        ...prev,
        {
          sectionType: 'category' as const,
          categoryId: cat.id,
          categoryName: cat.name,
          sortOrder: prev.length,
        },
      ]);
      setDirty(true);
      setShowCategoryPicker(false);
    },
    [localSections]
  );

  const addBuiltIn = useCallback(
    (type: 'popular' | 'new_releases') => {
      if (localSections.length >= MAX_SECTIONS) return;
      if (localSections.some((s) => s.sectionType === type)) return;

      setLocalSections((prev) => [
        ...prev,
        { sectionType: type, categoryId: null, categoryName: null, sortOrder: prev.length },
      ]);
      setDirty(true);
    },
    [localSections]
  );

  const removeSection = useCallback((index: number) => {
    setLocalSections((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  const moveSection = useCallback((from: number, to: number) => {
    setLocalSections((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
  }, []);

  // Drag handlers
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    moveSection(dragIndex, index);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  if (!isOpen) return null;

  const hasPopular = localSections.some((s) => s.sectionType === 'popular');
  const hasNewReleases = localSections.some((s) => s.sectionType === 'new_releases');
  const existingCategoryIds = new Set(
    localSections.filter((s) => s.sectionType === 'category').map((s) => s.categoryId)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Customize Home
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {localSections.length}/{MAX_SECTIONS} sections
              {saving && (
                <span className="ml-2 text-blue-500 dark:text-blue-400">Saving...</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Section list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {localSections.length === 0 && (
            <div className="text-center text-gray-400 dark:text-gray-500 py-8">
              <p className="text-sm">No sections configured.</p>
              <p className="text-xs mt-1">Add sections below to customize your home page.</p>
            </div>
          )}

          {localSections.map((section, index) => (
            <div
              key={`${section.sectionType}-${section.categoryId || index}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200
                ${dragIndex === index
                  ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md scale-[1.02]'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              {/* Drag handle */}
              <div className="cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hidden sm:block">
                <Bars3Icon className="w-4 h-4" />
              </div>

              {/* Color dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${SECTION_COLORS[index % SECTION_COLORS.length]}`} />

              {/* Label */}
              <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {getSectionLabel(section)}
              </span>

              {/* Mobile reorder arrows */}
              <div className="flex sm:hidden gap-0.5">
                <button
                  onClick={() => index > 0 && moveSection(index, index - 1)}
                  disabled={index === 0}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-25"
                  aria-label="Move up"
                >
                  <ChevronUpIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => index < localSections.length - 1 && moveSection(index, index + 1)}
                  disabled={index === localSections.length - 1}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-25"
                  aria-label="Move down"
                >
                  <ChevronDownIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Remove */}
              <button
                onClick={() => removeSection(index)}
                className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                aria-label={`Remove ${getSectionLabel(section)}`}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Add section controls */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          {/* Built-in section buttons */}
          <div className="flex gap-2 flex-wrap">
            {!hasPopular && (
              <button
                onClick={() => addBuiltIn('popular')}
                disabled={localSections.length >= MAX_SECTIONS}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Popular
              </button>
            )}
            {!hasNewReleases && (
              <button
                onClick={() => addBuiltIn('new_releases')}
                disabled={localSections.length >= MAX_SECTIONS}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                New Releases
              </button>
            )}
            <button
              onClick={loadCategories}
              disabled={localSections.length >= MAX_SECTIONS || loadingCategories}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors disabled:opacity-50"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {loadingCategories ? 'Loading...' : 'Category'}
            </button>
          </div>

          {/* Category picker: top-level categories, each expandable to its sub-categories */}
          {showCategoryPicker && (
            <CategoryPicker
              categories={categories}
              existingIds={existingCategoryIds}
              onPick={addCategory}
              onCancel={() => setShowCategoryPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
