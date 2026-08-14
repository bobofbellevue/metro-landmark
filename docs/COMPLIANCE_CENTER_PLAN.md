# Compliance Center Implementation Plan

## Overview

The Compliance Center provides guided workflows and document generation for landlord-tenant procedures that must comply with Washington State and City of Seattle regulations. The system ensures proper notice periods, required formats, and banned procedures are followed.

## Current State

### Existing Implementation
- Basic `CompliancePage.jsx` with placeholder cards for:
  - Rent Increase Notice
  - Eviction Process
  - Security Deposit Return
- `legal_notices` table exists in schema (basic structure)
- Lease renewal exists on Leases page (consider moving to Compliance Center)

### Missing
- No database schema for compliance workflows
- No document generation for compliance notices
- No guided workflows
- No regulation rule engine
- No notice period calculations
- No compliance tracking/audit trail

## Compliance Processes to Implement

### High Priority (Core Processes)

1. **Rent Increase Notice**
   - Calculate required notice period (30/60/90 days based on lease type and location)
   - Generate compliant notice document
   - Track notice delivery and effective date
   - Seattle-specific: Rent increase limitations and just cause requirements

2. **Lease Renewal**
   - Generate renewal offer with proper notice period
   - Handle month-to-month vs. fixed-term renewals
   - Track renewal acceptance/rejection
   - Generate renewal lease document
   - **Consideration**: Move from Leases page to Compliance Center for better workflow

3. **Move-In Process**
   - Property condition report generation
   - Move-in inspection checklist
   - Document existing damage/conditions
   - Tenant acknowledgment and signature
   - Required disclosures (lead paint, mold, etc.)
   - Key handover documentation

4. **Move-Out Process**
   - Move-out inspection scheduling
   - Property condition comparison (move-in vs. move-out)
   - Damage assessment and documentation
   - Security deposit calculation
   - Final walkthrough documentation
   - Required notice periods for tenant move-out

5. **Security Deposit Return**
   - Calculate deductions with itemized list
   - Required 14-day timeline (WA state)
   - Generate deposit return statement
   - Track deposit return status
   - Handle deposit disputes

6. **Collections Process**
   - Late rent notices (3-day, 10-day, 14-day)
   - NSF check handling
   - Payment plan agreements
   - Debt collection compliance (FDCPA)
   - Small claims court preparation

### Medium Priority (Eviction & Notices)

7. **Eviction Process (Multi-Step Workflow)**
   - 3-Day Pay or Vacate Notice
   - 10-Day Compliance Notice (for lease violations)
   - 14-Day Unconditional Quit Notice
   - 20-Day Notice for Lease Violations
   - Court filing preparation
   - Service of process tracking
   - Seattle-specific: Just cause eviction requirements

8. **Lease Violation Notices**
   - Noise complaints
   - Pet policy violations
   - Unauthorized occupants
   - Property damage
   - Nuisance complaints
   - Required cure periods

9. **Lease Termination Notices**
   - Tenant-initiated termination
   - Landlord-initiated termination (with cause)
   - Mutual termination agreements
   - Required notice periods

### Lower Priority (Additional Compliance)

10. **Habitability Issues**
    - Repair and deduct process
    - Required repair timelines
    - Tenant rights documentation
    - Emergency repair procedures

11. **Entry Notices**
    - 24-hour notice requirement tracking
    - Entry reason documentation
    - Tenant consent tracking
    - Emergency entry exceptions

12. **Tenant Screening Compliance**
    - Fair Housing Act compliance
    - Application fee limits
    - Screening criteria documentation
    - Adverse action notices

13. **Rent Control Compliance (Seattle)**
    - Rent increase caps
    - Just cause eviction tracking
    - Registration requirements
    - Annual reporting

## Database Schema

### Compliance Workflows Table

```sql
CREATE TABLE compliance_workflows (
  workflow_id SERIAL PRIMARY KEY,
  workflow_type VARCHAR(100) NOT NULL,  -- 'rent_increase', 'eviction', 'move_in', etc.
  lease_id INTEGER REFERENCES leases(lease_id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(unit_id) ON DELETE SET NULL,
  property_id INTEGER REFERENCES properties(property_id) ON DELETE SET NULL,
  tenant_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE SET NULL,
  
  -- Workflow status
  status VARCHAR(50) NOT NULL DEFAULT 'draft',  -- 'draft', 'in_progress', 'completed', 'cancelled'
  current_step INTEGER DEFAULT 1,
  total_steps INTEGER NOT NULL,
  
  -- Compliance tracking
  jurisdiction VARCHAR(50) NOT NULL,  -- 'washington_state', 'seattle', 'other_city'
  notice_period_days INTEGER,
  required_notice_date DATE,
  effective_date DATE,
  served_date DATE,
  served_method VARCHAR(50),  -- 'in_person', 'certified_mail', 'posting', 'email'
  proof_of_service TEXT,
  
  -- Workflow data (flexible JSONB for different workflow types)
  workflow_data JSONB DEFAULT '{}',
  
  -- Audit trail
  created_by_user_id INTEGER REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_compliance_workflows_type ON compliance_workflows(workflow_type);
CREATE INDEX idx_compliance_workflows_lease ON compliance_workflows(lease_id);
CREATE INDEX idx_compliance_workflows_status ON compliance_workflows(status);
CREATE INDEX idx_compliance_workflows_jurisdiction ON compliance_workflows(jurisdiction);
```

### Enhanced Legal Notices Table

```sql
-- Expand existing legal_notices table
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS workflow_id INTEGER REFERENCES compliance_workflows(workflow_id) ON DELETE SET NULL;
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS notice_category VARCHAR(50);  -- 'rent_increase', 'eviction', 'violation', etc.
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(50) NOT NULL DEFAULT 'washington_state';
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS required_notice_days INTEGER;
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS served_method VARCHAR(50);
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS proof_of_service TEXT;
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS document_path TEXT;  -- Path to generated PDF
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS notice_data JSONB DEFAULT '{}';  -- Flexible data storage
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE legal_notices ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### Move-In/Move-Out Inspection Tables

```sql
CREATE TABLE property_inspections (
  inspection_id SERIAL PRIMARY KEY,
  lease_id INTEGER REFERENCES leases(lease_id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  inspection_type VARCHAR(50) NOT NULL,  -- 'move_in', 'move_out', 'periodic', 'damage'
  inspection_date DATE NOT NULL,
  conducted_by_user_id INTEGER REFERENCES users(user_id),
  tenant_present BOOLEAN DEFAULT false,
  tenant_user_id INTEGER REFERENCES users(user_id),
  
  -- Inspection data
  condition_report JSONB NOT NULL DEFAULT '{}',  -- Room-by-room condition
  photos JSONB DEFAULT '[]',  -- Array of photo URLs/paths
  notes TEXT,
  overall_condition VARCHAR(50),  -- 'excellent', 'good', 'fair', 'poor'
  
  -- Signatures
  tenant_signed BOOLEAN DEFAULT false,
  tenant_signed_at TIMESTAMP,
  landlord_signed BOOLEAN DEFAULT false,
  landlord_signed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_property_inspections_lease ON property_inspections(lease_id);
CREATE INDEX idx_property_inspections_type ON property_inspections(inspection_type);
CREATE INDEX idx_property_inspections_date ON property_inspections(inspection_date);
```

### Compliance Rules Table (Regulation Engine)

```sql
CREATE TABLE compliance_rules (
  rule_id SERIAL PRIMARY KEY,
  rule_name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(100) NOT NULL,  -- 'notice_period', 'prohibited_action', 'required_disclosure', etc.
  jurisdiction VARCHAR(50) NOT NULL,  -- 'washington_state', 'seattle', 'other_city'
  applies_to VARCHAR(100),  -- 'rent_increase', 'eviction', 'deposit', etc.
  
  -- Rule definition
  rule_condition JSONB NOT NULL,  -- Conditions when rule applies
  rule_action TEXT NOT NULL,  -- What the rule requires
  notice_period_days INTEGER,  -- If applicable
  prohibited BOOLEAN DEFAULT false,  -- If this action is banned
  
  -- Metadata
  source TEXT,  -- Legal citation
  effective_date DATE,
  expiration_date DATE,
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_compliance_rules_jurisdiction ON compliance_rules(jurisdiction, is_active);
CREATE INDEX idx_compliance_rules_applies_to ON compliance_rules(applies_to, is_active);
```

### Written Policies Table

Written policies define the standards and procedures for each compliance process. Policies are required for legal protection (especially for applicant screening in Seattle's "first qualifying applicant" rule) and ensure consistent, documented decision-making.

```sql
CREATE TABLE compliance_policies (
  policy_id SERIAL PRIMARY KEY,
  policy_type VARCHAR(100) NOT NULL,  -- 'applicant_screening', 'rent_increase', 'eviction', 'move_in', etc.
  policy_level VARCHAR(50) NOT NULL,  -- 'system', 'company', 'landlord', 'property'
  
  -- Scope (polymorphic - only one should be set based on level)
  pmc_id INTEGER REFERENCES pm_companies(pmc_id) ON DELETE CASCADE,  -- For 'company' level
  landlord_id INTEGER REFERENCES landlords(landlord_id) ON DELETE CASCADE,  -- For 'landlord' level
  property_id INTEGER REFERENCES properties(property_id) ON DELETE CASCADE,  -- For 'property' level
  
  -- Policy metadata
  policy_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,  -- Default policy for this level/type
  is_active BOOLEAN DEFAULT true,
  
  -- Policy content (template-driven, flexible JSONB structure)
  policy_data JSONB NOT NULL DEFAULT '{}',
  
  -- Inheritance
  inherits_from_policy_id INTEGER REFERENCES compliance_policies(policy_id) ON DELETE SET NULL,
  inheritance_mode VARCHAR(50) DEFAULT 'extend',  -- 'extend' (add to parent) or 'replace' (override parent)
  
  -- Template reference (if based on a template)
  template_id INTEGER REFERENCES templates(template_id) ON DELETE SET NULL,
  
  -- Audit
  created_by_user_id INTEGER REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  version INTEGER DEFAULT 1,
  
  -- Constraints
  CONSTRAINT policy_level_check CHECK (
    (policy_level = 'system' AND pmc_id IS NULL AND landlord_id IS NULL AND property_id IS NULL) OR
    (policy_level = 'company' AND pmc_id IS NOT NULL AND landlord_id IS NULL AND property_id IS NULL) OR
    (policy_level = 'landlord' AND landlord_id IS NOT NULL AND property_id IS NULL) OR
    (policy_level = 'property' AND property_id IS NOT NULL)
  )
);

CREATE INDEX idx_compliance_policies_type_level ON compliance_policies(policy_type, policy_level);
CREATE INDEX idx_compliance_policies_pmc ON compliance_policies(pmc_id) WHERE pmc_id IS NOT NULL;
CREATE INDEX idx_compliance_policies_landlord ON compliance_policies(landlord_id) WHERE landlord_id IS NOT NULL;
CREATE INDEX idx_compliance_policies_property ON compliance_policies(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX idx_compliance_policies_active ON compliance_policies(is_active) WHERE is_active = true;
```

### Policy Data Structure (JSONB)

The `policy_data` JSONB field uses a template-driven structure that allows flexibility while maintaining consistency. Example for applicant screening:

```json
{
  "template_version": "1.0",
  "sections": [
    {
      "section_id": "income_requirements",
      "section_title": "Income Requirements",
      "fields": [
        {
          "field_id": "minimum_income_ratio",
          "field_type": "number",
          "label": "Minimum Income to Rent Ratio",
          "value": 3.0,
          "required": true,
          "description": "Applicant must earn at least 3x monthly rent"
        },
        {
          "field_id": "accept_co_signers",
          "field_type": "boolean",
          "label": "Accept Co-Signers",
          "value": true,
          "required": false
        }
      ]
    },
    {
      "section_id": "credit_requirements",
      "section_title": "Credit Requirements",
      "fields": [
        {
          "field_id": "minimum_credit_score",
          "field_type": "number",
          "label": "Minimum Credit Score",
          "value": 650,
          "required": true
        },
        {
          "field_id": "allow_bankruptcies",
          "field_type": "boolean",
          "label": "Allow Applicants with Bankruptcies",
          "value": false,
          "required": false
        }
      ]
    },
    {
      "section_id": "rental_history",
      "section_title": "Rental History Requirements",
      "fields": [
        {
          "field_id": "minimum_rental_history_months",
          "field_type": "number",
          "label": "Minimum Rental History (months)",
          "value": 12,
          "required": true
        },
        {
          "field_id": "allow_evictions",
          "field_type": "boolean",
          "label": "Allow Applicants with Prior Evictions",
          "value": false,
          "required": false
        }
      ]
    },
    {
      "section_id": "qualification_order",
      "section_title": "Qualification Order (Seattle First Qualified Applicant Rule)",
      "fields": [
        {
          "field_id": "application_order",
          "field_type": "select",
          "label": "Application Processing Order",
          "value": "first_qualified",
          "options": ["first_qualified", "first_applied", "best_qualified"],
          "required": true,
          "description": "Seattle requires 'first_qualified' - must approve first applicant who meets all criteria"
        }
      ]
    }
  ],
  "additional_notes": "This policy applies to all properties managed by this company. Individual landlords may add additional requirements."
}
```

### Policy Inheritance Model

Policies inherit from higher levels using a hierarchical model:

1. **System Level**: Base policies for all processes (initialized via db-util)
2. **Company Level**: PM company-specific policies (inherit from system, add company-specific rules)
3. **Landlord Level**: Landlord-specific policies (inherit from company or system, add landlord preferences)
4. **Property Level**: Property-specific policies (inherit from landlord/company/system, add property-specific rules)

**Inheritance Logic:**
- When retrieving a policy, start at property level
- If not found, check landlord level
- If not found, check company level
- If not found, use system level
- Merge policies based on `inheritance_mode`:
  - `extend`: All parent policy fields apply, plus any additional fields in child policy
  - `replace`: Child policy completely replaces parent (use sparingly)

**Example Inheritance Chain:**
```
System Policy (applicant_screening)
  └─> Company Policy (extends system, adds: "Require 3.5x income ratio")
      └─> Landlord Policy (extends company, adds: "No pets allowed")
          └─> Property Policy (extends landlord, adds: "Allow small dogs under 25lbs")
```

### Policy Templates

Policies are template-driven, similar to application/lease templates:

1. **System Templates**: Define the structure and available fields for each policy type
2. **Policy Instances**: Created from templates, with values filled in
3. **Template Management**: Similar to existing template system in `templates` table

**Template Structure:**
- Defines available sections and fields
- Field types: number, boolean, text, select, date, etc.
- Validation rules
- Default values
- Required vs. optional fields

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

1. **Database Schema**
   - Create `compliance_workflows` table
   - Enhance `legal_notices` table
   - Create `property_inspections` table
   - Create `compliance_rules` table
   - Create `compliance_policies` table
   - Add jurisdiction tracking to properties table

2. **Written Policies System**
   - Create policy templates for all 13 compliance processes
   - Initialize system-wide default policies via db-util
   - Implement policy inheritance logic
   - Create policy retrieval function (with inheritance)
   - Policy management UI (view/edit policies)

3. **Compliance Rules Engine**
   - Load Washington State rules
   - Load Seattle-specific rules
   - Create rule evaluation functions
   - Calculate notice periods based on rules

4. **Basic Workflow Framework**
   - Workflow state management
   - Step-by-step guided process
   - Data collection forms
   - Progress tracking
   - Integration with policies (retrieve applicable policy for workflow)

### Phase 2: Core Processes (Week 3-5)

4. **Applicant Screening (Policy-Driven)**
   - Retrieve applicable screening policy (system/company/landlord/property)
   - Apply policy criteria to evaluate applicants
   - Document approval/rejection based on policy
   - Track "first qualifying applicant" for Seattle compliance
   - Generate rejection letters referencing policy (without sharing policy details)
   - Policy compliance validation

5. **Rent Increase Notice**
   - Retrieve applicable rent increase policy
   - Calculate notice period (30/60/90 days) based on policy and regulations
   - Generate compliant notice document
   - Track delivery and service
   - Handle Seattle rent control limits per policy

6. **Move-In Process**
   - Retrieve applicable move-in policy
   - Property condition report template (per policy requirements)
   - Inspection checklist (customized per policy)
   - Photo upload capability
   - Required disclosures (per policy and regulations)
   - Digital signature capture
   - Policy-specific move-in procedures

7. **Move-Out Process**
   - Retrieve applicable move-out policy
   - Move-out inspection scheduling
   - Condition comparison (move-in vs. move-out)
   - Damage assessment (per policy standards)
   - Security deposit calculation (per policy rules)
   - Final documentation

8. **Security Deposit Return**
   - Retrieve applicable deposit return policy
   - Automatic calculation from move-out inspection
   - Itemized deduction list (per policy standards)
   - 14-day timeline tracking
   - Generate deposit return statement
   - Document generation

### Phase 3: Collections & Notices (Week 6-8)

9. **Collections Process**
   - Retrieve applicable collections policy
   - Late rent notice generation (3-day, 10-day, 14-day) per policy
   - Payment plan workflow (per policy terms)
   - NSF check handling (per policy procedures)
   - Debt collection compliance
   - Policy-driven grace periods and fees

10. **Lease Violation Notices**
   - Retrieve applicable violation policy
   - Various violation types (defined in policy)
   - Cure period calculations (per policy)
   - Notice generation
   - Tracking and follow-up
   - Policy-defined escalation procedures

11. **Lease Renewal (Move from Leases Page)**
   - Retrieve applicable renewal policy
   - Renewal offer generation (per policy terms)
   - Notice period compliance
   - Acceptance/rejection tracking
   - Renewal lease document generation
   - Policy-driven renewal criteria

### Phase 4: Eviction Process (Week 9-10)

12. **Eviction Workflow**
    - Retrieve applicable eviction policy
    - Multi-step guided process
    - Notice type selection (3-day, 10-day, 14-day, 20-day) per policy
    - Court document preparation
    - Service of process tracking
    - Seattle just cause requirements
    - Policy-driven eviction procedures and documentation requirements

### Phase 5: Additional Features (Week 11-12)

13. **Habitability & Entry Notices**
    - Retrieve applicable habitability/entry policies
    - Repair and deduct process (per policy)
    - Entry notice tracking
    - Emergency entry documentation
    - Policy-defined repair timelines and procedures

14. **Policy Management System**
    - Policy creation/editing UI
    - Template-based policy builder
    - Policy inheritance visualization
    - Policy versioning and history
    - Policy comparison tool (view merged policy)
    - Bulk policy operations

15. **Compliance Dashboard**
    - Active workflows view
    - Upcoming deadlines
    - Compliance status by property/lease
    - Policy compliance tracking
    - Audit trail
    - Policy usage analytics

## Key Features

### 1. Written Policies System
- **Multi-Level Policies**: System, company, landlord, and property-level policies
- **Template-Driven**: Flexible JSONB structure allows custom fields per policy type
- **Inheritance**: Child policies extend parent policies automatically
- **Required for Compliance**: Especially critical for applicant screening (Seattle "first qualifying applicant" rule)
- **Policy Application**: All workflows retrieve and apply the appropriate policy
- **Initialization**: System-wide default policies loaded via db-util

### 2. Jurisdiction Detection
- Automatically detect if property is in Seattle vs. other WA cities
- Apply correct rules based on jurisdiction
- Handle different notice periods and requirements

### 3. Notice Period Calculator
- Calculate required notice periods based on:
  - Lease type (month-to-month vs. fixed-term)
  - Jurisdiction (Seattle vs. WA state)
  - Notice type (rent increase, termination, etc.)
  - Current date and lease terms

### 3. Document Generation
- Generate compliant PDF documents
- Use templates from `templates` table
- Populate with lease/property/tenant data
- Include required legal language
- Store generated documents in `documents` table

### 4. Guided Workflows
- Step-by-step process for each compliance action
- Required information collection
- Validation at each step
- Cannot proceed without required data
- Progress saving

### 5. Compliance Validation
- Check rules before allowing actions
- Warn about prohibited procedures
- Validate notice periods
- Ensure required disclosures are provided

### 6. Policy Integration
- Every compliance workflow retrieves applicable policy
- Workflow steps guided by policy requirements
- Document generation includes policy-compliant language
- Decision-making documented against policy criteria
- Policy versioning tracked for audit purposes

### 7. Audit Trail
- Track who initiated each workflow
- Record all actions and dates
- Store proof of service
- Maintain complete history
- Track which policy version was used
- Document policy-based decisions

## Integration Points

### With Existing Systems

1. **Leases**: Link workflows to leases, pull lease data
2. **Properties**: Get jurisdiction, property details
3. **Tenants**: Get tenant information, contact methods
4. **Documents**: Store generated compliance documents
5. **Templates**: Use for document generation
6. **Users**: Track who created/completed workflows

### API Endpoints Needed

```
POST /api/compliance/workflows - Start new workflow
GET /api/compliance/workflows/:id - Get workflow details
PUT /api/compliance/workflows/:id - Update workflow step
POST /api/compliance/workflows/:id/complete - Complete workflow
POST /api/compliance/workflows/:id/cancel - Cancel workflow

POST /api/compliance/notices/generate - Generate notice document
POST /api/compliance/notices/serve - Mark notice as served

GET /api/compliance/rules?jurisdiction=X&type=Y - Get applicable rules
POST /api/compliance/rules/validate - Validate action against rules

POST /api/compliance/inspections - Create inspection
GET /api/compliance/inspections/:id - Get inspection details
PUT /api/compliance/inspections/:id - Update inspection

GET /api/compliance/policies?type=X&property_id=Y - Get applicable policy (with inheritance)
GET /api/compliance/policies/:id - Get policy details
POST /api/compliance/policies - Create new policy
PUT /api/compliance/policies/:id - Update policy
DELETE /api/compliance/policies/:id - Delete policy
GET /api/compliance/policies/:id/merged - Get merged policy (with all inheritance)
GET /api/compliance/policies/templates - Get policy templates
```

## UI Components

### Compliance Center Main Page
- Grid of compliance process cards
- Each card shows:
  - Process name
  - Description
  - Status indicators (if workflow in progress)
  - "Start Workflow" button

### Workflow Wizard
- Multi-step form component
- Progress indicator
- Step validation
- Save and resume capability
- Review before completion
- Policy display (show applicable policy being used)
- Policy compliance indicators

### Policy Management Interface
- Policy list view (filterable by type, level)
- Policy editor (template-driven form builder)
- Policy inheritance visualization (tree view)
- Policy comparison tool (view merged policy)
- Policy version history
- Create policy from template
- Copy/clone policies

### Compliance Dashboard
- Active workflows list
- Upcoming deadlines
- Compliance status overview
- Recent activity
- Policy compliance status
- Missing policies alerts

## Washington State & Seattle Specific Rules

### Applicant Screening (Critical for Policies)
- **Seattle**: "First Qualified Applicant" rule - must approve first applicant who meets all criteria
- **Seattle**: Written screening criteria required (policy must be documented)
- **WA State**: Fair Housing Act compliance required
- **WA State**: Cannot discriminate based on protected classes
- **Policy Requirement**: Must have written policy defining approval criteria
- **Policy Usage**: Use policy to evaluate applicants, but don't share policy details with applicants

### Rent Increases
- **WA State**: 30 days notice for month-to-month, 60 days for increases >10%
- **Seattle**: Additional restrictions, rent control in some areas
- **Seattle**: Just cause required for rent increases in some cases
- **Policy**: Define rent increase procedures and criteria in written policy

### Evictions
- **WA State**: 3-day pay or vacate, 10-day compliance, 14-day unconditional quit
- **Seattle**: Just cause eviction required, additional protections
- **Seattle**: Relocation assistance required in some cases

### Security Deposits
- **WA State**: 14 days to return or provide itemized deductions
- **WA State**: Maximum deposit limits
- **Seattle**: Additional requirements

### Move-In/Move-Out
- **WA State**: Property condition reports required
- **WA State**: Written checklist required
- **WA State**: Tenant has right to be present at inspection

### Entry
- **WA State**: 24-hour notice required (except emergencies)
- **WA State**: Entry must be during reasonable hours
- **WA State**: Tenant consent for non-emergency entry

## Testing Considerations

1. **Rule Validation**: Test all compliance rules are correctly applied
2. **Notice Periods**: Verify calculations for different scenarios
3. **Document Generation**: Ensure all required language is included
4. **Workflow Completion**: Test all workflow paths
5. **Jurisdiction Detection**: Verify Seattle vs. WA state rules
6. **Audit Trail**: Verify all actions are logged

## Policy Initialization (db-util)

System-wide default policies should be initialized through `db-util-server.js`:

1. **Create Policy Templates**: Define structure for each policy type
2. **Initialize System Policies**: Create default system-wide policies for:
   - Applicant Screening (with Seattle "first qualified" rule)
   - Rent Increase
   - Eviction Process
   - Move-In Process
   - Move-Out Process
   - Security Deposit Return
   - Collections
   - Lease Violations
   - Lease Termination
   - Habitability Issues
   - Entry Notices
   - Tenant Screening Compliance
   - Rent Control Compliance

3. **Policy Template Files**: Store in `public/policies/` or similar, similar to templates
4. **Initialization Function**: Load policies during database setup

## Future Enhancements

- Integration with court filing systems
- Automated deadline reminders
- Compliance reporting and analytics
- Multi-jurisdiction support (beyond Seattle)
- Mobile app for inspections
- Electronic service of process
- Integration with payment systems for collections
- Policy analytics (which policies are most effective)
- Policy compliance scoring
- Automated policy updates based on regulation changes

## References

- Washington State Residential Landlord-Tenant Act (RCW 59.18)
- Seattle Municipal Code - Rental Regulations
- Fair Housing Act compliance
- FDCPA (Fair Debt Collection Practices Act) compliance

