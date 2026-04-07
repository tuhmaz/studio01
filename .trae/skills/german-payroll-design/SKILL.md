---
name: "german-payroll-design"
description: "Optimizes German payroll slip design for printing and official formatting. Invoke when user requests German-style payroll formatting or single-page printing."
---

# German Payroll Design Skill

This skill handles the optimization of German payroll slips (Lohnzettel) for professional printing and official German formatting standards.

## Key Features
- Single-page printing optimization
- Official German payroll formatting
- Professional typography and layout
- Print-friendly styling
- Compliance with German payroll standards

## Implementation Guidelines
1. Use A4 paper size (210mm × 297mm)
2. Apply official German payroll structure
3. Ensure all content fits on one page
4. Use professional fonts and spacing
5. Include required legal information
6. Optimize for both screen and print

## Common German Payroll Elements
- Company header with address and tax ID
- Employee information section
- Earnings breakdown (Bruttolohn)
- Deductions (Steuern, Sozialversicherung)
- Net pay calculation (Nettolohn)
- Legal disclaimers and signatures

## CSS for Print Optimization
```css
@media print {
  @page { margin: 15mm; size: A4; }
  body { -webkit-print-color-adjust: exact; }
  .payroll-slip { 
    width: 100%; 
    font-size: 11pt; 
    line-height: 1.2;
  }
}
```