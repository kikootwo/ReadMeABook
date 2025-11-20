/**
 * Component: Setup Wizard Layout
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import React from 'react';

interface WizardLayoutProps {
  currentStep: number;
  totalSteps: number;
  children: React.ReactNode;
}

export function WizardLayout({ currentStep, totalSteps, children }: WizardLayoutProps) {
  const steps = [
    { number: 1, title: 'Welcome' },
    { number: 2, title: 'Admin Account' },
    { number: 3, title: 'Plex' },
    { number: 4, title: 'Prowlarr' },
    { number: 5, title: 'Download Client' },
    { number: 6, title: 'Paths' },
    { number: 7, title: 'BookDate' },
    { number: 8, title: 'Review' },
    { number: 9, title: 'Finalize' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            ReadMeABook Setup
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Configure your audiobook automation system
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="flex items-center justify-between py-4">
            {steps.map((step, index) => (
              <React.Fragment key={step.number}>
                {/* Step Circle */}
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center font-semibold
                      ${
                        step.number < currentStep
                          ? 'bg-green-500 text-white'
                          : step.number === currentStep
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }
                    `}
                  >
                    {step.number < currentStep ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      step.number
                    )}
                  </div>
                  <span
                    className={`
                      text-xs mt-2 text-center
                      ${
                        step.number === currentStep
                          ? 'text-blue-600 dark:text-blue-400 font-medium'
                          : 'text-gray-600 dark:text-gray-400'
                      }
                    `}
                  >
                    {step.title}
                  </span>
                </div>

                {/* Connecting Line */}
                {index < steps.length - 1 && (
                  <div
                    className={`
                      h-1 flex-1 mx-2 rounded
                      ${
                        step.number < currentStep
                          ? 'bg-green-500'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }
                    `}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 py-4">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-sm text-center text-gray-600 dark:text-gray-400">
            Step {currentStep} of {totalSteps}
          </p>
        </div>
      </div>
    </div>
  );
}
