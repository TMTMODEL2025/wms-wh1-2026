# Implementation Plan - SAP Fiori Style Mobile Responsive View Optimization

## User Requirements
1. **SAP Fiori Mobile Design**: Optimize views for mobile devices by hiding non-essential elements, collapsing sidebars automatically, and ensuring comfortable readability.
2. **Compact Card Layouts**: Transform dense data tables into clean, touch-friendly SAP Fiori mobile cards on small screens (`max-width: 768px`).
3. **Collapsible Auxiliary Content**: Automatically collapse sidebars and hide verbose subtitles/descriptions on mobile screens.

## Proposed Changes

### 1. Global CSS & Media Queries (`App.tsx`)
- Enhance CSS media queries (`@media (max-width: 768px)`) to automatically collapse the sidebar into a compact bottom or overlay drawer navigation.
- Hide non-essential descriptive paragraphs and subcaptions on mobile screens.
- Provide responsive card view styles for lists.

### 2. Component Responsive Enhancements
- Ensure key components (`TransportOperations`, `FixFlushManagement`, `FuelManagement`, `PreStartInspection`, `VehicleManagement`, `EmployeeManagement`) adapt cleanly to mobile screens by rendering SAP Fiori style list cards instead of wide horizontal tables when viewport is narrow.

## Verification Plan
- Run `compile_applet` and `lint_applet` to ensure zero compilation or type errors.
- Test responsive behavior across mobile viewports (e.g. hiding verbose headers, collapsible sidebar, card lists).
