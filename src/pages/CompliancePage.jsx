import React, { useState, useContext, useEffect } from 'react';
import { 
  Shield, FileText, Banknote, Home, ArrowRight, 
  UserCheck, Calendar, AlertTriangle, Key, DoorOpen,
  ClipboardCheck, DollarSign, Gavel, Wrench,
  Lock, Search, TrendingUp, Clock, CheckCircle, Trash2
} from 'lucide-react';
import { AuthContext, SidebarContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import { supabase } from '../lib/supabase';
import { readResponseJson } from '../utils/read-response-json.js';
import { isAwaitingNoticeService, GENERATE_THEN_SERVE_WORKFLOW_TYPES } from '../utils/notice-service-workflow.js';
import { hydrateWorkflowData } from '../utils/compliance-workflow-persistence.js';
import { COMPLIANCE_WORKFLOW_TITLES, complianceWorkflowTitle } from '../config/compliance-workflows.js';

// Import workflow components
import RentIncreaseWorkflow from '../components/compliance/RentIncreaseWorkflow';
import LeaseRenewalWorkflow from '../components/compliance/LeaseRenewalWorkflow';
import MoveInWorkflow from '../components/compliance/MoveInWorkflow';
import MoveOutWorkflow from '../components/compliance/MoveOutWorkflow';
import SecurityDepositReturnWorkflow from '../components/compliance/SecurityDepositReturnWorkflow';
import CollectionsWorkflow from '../components/compliance/CollectionsWorkflow';
import EvictionWorkflow from '../components/compliance/EvictionWorkflow';
import LeaseViolationWorkflow from '../components/compliance/LeaseViolationWorkflow';
import LeaseTerminationWorkflow from '../components/compliance/LeaseTerminationWorkflow';
import HabitabilityWorkflow from '../components/compliance/HabitabilityWorkflow';
import EntryNoticesWorkflow from '../components/compliance/EntryNoticesWorkflow';
import TenantScreeningWorkflow from '../components/compliance/TenantScreeningWorkflow';

// Compliance process definitions
const COMPLIANCE_PROCESSES = [
  {
    id: 'rent_increase',
    title: COMPLIANCE_WORKFLOW_TITLES.rent_increase,
    description: 'Calculate the notice period, generate the PDF, then print or email it and record service (or save for later).',
    icon: <TrendingUp className="w-8 h-8 text-blue-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'lease_renewal',
    title: COMPLIANCE_WORKFLOW_TITLES.lease_renewal,
    description: 'Generate renewal offer with proper notice period and track acceptance.',
    icon: <Calendar className="w-8 h-8 text-green-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'move_in',
    title: COMPLIANCE_WORKFLOW_TITLES.move_in,
    description: 'Property condition report, inspection checklist, and required disclosures.',
    icon: <Key className="w-8 h-8 text-purple-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'move_out',
    title: COMPLIANCE_WORKFLOW_TITLES.move_out,
    description: 'Move-out inspection, condition comparison, and damage assessment.',
    icon: <DoorOpen className="w-8 h-8 text-orange-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'security_deposit',
    title: COMPLIANCE_WORKFLOW_TITLES.security_deposit,
    description: 'Calculate deductions and generate a deposit return statement within the pack timeline (30 days under WA/Seattle).',
    icon: <Banknote className="w-8 h-8 text-green-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'collections',
    title: COMPLIANCE_WORKFLOW_TITLES.collections,
    description: 'Late rent notices, payment plans, and debt collection compliance.',
    icon: <DollarSign className="w-8 h-8 text-red-500" />,
    priority: 'high',
    category: 'core'
  },
  {
    id: 'eviction',
    title: COMPLIANCE_WORKFLOW_TITLES.eviction,
    description: 'Generate the eviction notice, then print or email it and record service (or save for later).',
    icon: <Gavel className="w-8 h-8 text-red-500" />,
    priority: 'medium',
    category: 'notices'
  },
  {
    id: 'lease_violation',
    title: COMPLIANCE_WORKFLOW_TITLES.lease_violation,
    description: 'Generate violation notices with required cure periods.',
    icon: <AlertTriangle className="w-8 h-8 text-yellow-500" />,
    priority: 'medium',
    category: 'notices'
  },
  {
    id: 'lease_termination',
    title: COMPLIANCE_WORKFLOW_TITLES.lease_termination,
    description: 'End a tenancy with pack notice days, just-cause / renewal-offer checks, then generate a worksheet and record service.',
    icon: <FileText className="w-8 h-8 text-gray-500" />,
    priority: 'medium',
    category: 'notices'
  },
  {
    id: 'habitability',
    title: COMPLIANCE_WORKFLOW_TITLES.habitability,
    description: 'Repair and deduct process, required timelines, and tenant rights.',
    icon: <Wrench className="w-8 h-8 text-blue-500" />,
    priority: 'low',
    category: 'additional'
  },
  {
    id: 'entry_notice',
    title: COMPLIANCE_WORKFLOW_TITLES.entry_notice,
    description: 'Track two-day entry notice (one day for showings) and document exceptions.',
    icon: <Lock className="w-8 h-8 text-indigo-500" />,
    priority: 'low',
    category: 'additional'
  },
  {
    id: 'tenant_screening',
    title: COMPLIANCE_WORKFLOW_TITLES.tenant_screening,
    description: 'Screen the applicant queue in received order. Seattle first-qualified: decide earlier pending applications first.',
    icon: <UserCheck className="w-8 h-8 text-teal-500" />,
    priority: 'low',
    category: 'additional'
  }
];

// This is the main component for the Compliance page
export default function CompliancePage() {
  const { user } = useContext(AuthContext);
  const { setActivePage } = useContext(SidebarContext);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [selectedWorkflowRecord, setSelectedWorkflowRecord] = useState(null);
  const [activeWorkflows, setActiveWorkflows] = useState([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);
  const [workflowPendingDelete, setWorkflowPendingDelete] = useState(null);
  const [isDeletingWorkflow, setIsDeletingWorkflow] = useState(false);
  const [completionNotice, setCompletionNotice] = useState(null);

  const categories = [
    { id: 'all', label: 'All Processes' },
    { id: 'core', label: 'Core Processes' },
    { id: 'notices', label: 'Notices & Evictions' },
    { id: 'additional', label: 'Additional Compliance' }
  ];

  const filteredProcesses = selectedCategory === 'all'
    ? COMPLIANCE_PROCESSES
    : COMPLIANCE_PROCESSES.filter(p => p.category === selectedCategory);

  useEffect(() => {
    fetchActiveWorkflows();
  }, []);

  const fetchActiveWorkflows = async () => {
    try {
      const { data, error } = await supabase
        .from('compliance_workflows')
        .select(ACTIVE_WORKFLOW_LIST_SELECT)
        .in('status', ['draft', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) throw error;
      setActiveWorkflows(data || []);
    } catch (error) {
      console.error('Error fetching active workflows:', error);
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  const handleStartWorkflow = (processId, workflowId = null, workflow = null) => {
    setSelectedProcess(processId);
    setSelectedWorkflowId(workflowId);
    setSelectedWorkflowRecord(workflow || null);
  };

  const handleWorkflowComplete = (_data, generationResult = null) => {
    setSelectedProcess(null);
    setSelectedWorkflowId(null);
    setSelectedWorkflowRecord(null);
    fetchActiveWorkflows();
    if (generationResult && generationResult.status && generationResult.status !== 'skipped') {
      setCompletionNotice(generationResult);
    }
  };

  const handleWorkflowCancel = () => {
    setSelectedProcess(null);
    setSelectedWorkflowId(null);
    setSelectedWorkflowRecord(null);
    fetchActiveWorkflows();
  };

  const handleDeleteWorkflow = async () => {
    if (!workflowPendingDelete?.workflow_id) return;
    setIsDeletingWorkflow(true);
    try {
      const response = await fetch(
        `/api/compliance/workflows?id=${workflowPendingDelete.workflow_id}`,
        { method: 'DELETE' }
      );
      const parsed = await readResponseJson(response);
      if (!parsed.ok) {
        throw new Error(parsed.error || 'Failed to delete workflow');
      }
      const result = parsed.data || {};
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete workflow');
      }
      setWorkflowPendingDelete(null);
      await fetchActiveWorkflows();
    } catch (error) {
      console.error('Error deleting workflow:', error);
      throw error;
    } finally {
      setIsDeletingWorkflow(false);
    }
  };

  const renderWorkflowComponent = () => {
    const workflowProps = {
      initialData: selectedWorkflowRecord
        ? hydrateWorkflowData(selectedWorkflowRecord)
        : {},
      workflowId: selectedWorkflowId,
      onComplete: handleWorkflowComplete,
      onCancel: handleWorkflowCancel,
      onWorkflowCreated: (workflow) => {
        if (workflow?.workflow_id != null) {
          setSelectedWorkflowId(workflow.workflow_id);
        }
      },
    };

    switch (selectedProcess) {
      case 'rent_increase':
        return (
          <RentIncreaseWorkflow
            {...workflowProps}
            openWorkflows={activeWorkflows.filter(
              (workflow) => workflow.workflow_type === 'rent_increase'
            )}
            onResumeWorkflow={(id) => {
              const row = activeWorkflows.find(
                (workflow) => String(workflow.workflow_id) === String(id)
              );
              setSelectedWorkflowRecord(row || null);
              setSelectedWorkflowId(id);
            }}
          />
        );
      case 'lease_renewal':
        return <LeaseRenewalWorkflow {...workflowProps} />;
      case 'move_in':
        return <MoveInWorkflow {...workflowProps} />;
      case 'move_out':
        return <MoveOutWorkflow {...workflowProps} />;
      case 'security_deposit':
        return <SecurityDepositReturnWorkflow {...workflowProps} />;
      case 'collections':
        return <CollectionsWorkflow {...workflowProps} />;
      case 'eviction':
        return <EvictionWorkflow {...workflowProps} />;
      case 'lease_violation':
        return <LeaseViolationWorkflow {...workflowProps} />;
      case 'lease_termination':
        return <LeaseTerminationWorkflow {...workflowProps} />;
      case 'habitability':
        return <HabitabilityWorkflow {...workflowProps} />;
      case 'entry_notice':
        return <EntryNoticesWorkflow {...workflowProps} />;
      case 'tenant_screening':
        return <TenantScreeningWorkflow {...workflowProps} />;
      case 'rent_control':
        return (
          <Card title="Process removed">
            <p className="text-sm text-gray-600">
              Rent-cap checks run inside Rent Increase Notice. This saved row is
              from a process that was removed. Delete it from Active Workflows if
              you no longer need it.
            </p>
          </Card>
        );
      default:
        return null;
    }
  };

  if (selectedProcess) {
    return (
      <div className="space-y-6">
        <button
          onClick={handleWorkflowCancel}
          className="mb-4 text-indigo-600 hover:text-indigo-800 flex items-center gap-2"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
          Back to Compliance Center
        </button>
        {renderWorkflowComponent()}
      </div>
    );
  }

  const workflowLabel = (workflow) => {
    if (workflow.workflow_type === 'rent_control') {
      return 'Rent Control (removed)';
    }
    return (
      complianceWorkflowTitle(workflow.workflow_type) ||
      workflow.workflow_type
    );
  };

  const isAdmin = user?.role === 'global_admin' || user?.role === 'company_admin';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Compliance Center</h2>
          <p className="text-gray-600 mt-2">
            Generate legally compliant documents and follow guided workflows for critical landlord-tenant procedures in Washington state.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setActivePage('Compliance Policies')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center space-x-2"
          >
            <Shield className="w-5 h-5" />
            <span>Manage Policies</span>
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        {categories.map(category => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedCategory === category.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>

      {/* Active Workflows Section */}
      {activeWorkflows.length > 0 && (
        <Card title="Active Workflows" className="mb-6">
          <div className="space-y-3">
            {[...activeWorkflows]
              .sort((a, b) => Number(isAwaitingNoticeService(b)) - Number(isAwaitingNoticeService(a)))
              .map(workflow => (
              <div
                key={workflow.workflow_id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
              >
                <button
                  type="button"
                  className="flex items-center gap-3 text-left flex-1 min-w-0"
                  onClick={() => handleStartWorkflow(workflow.workflow_type, workflow.workflow_id, workflow)}
                >
                  <div className={`p-2 rounded-full ${
                    isAwaitingNoticeService(workflow)
                      ? 'bg-amber-100'
                      : workflow.status === 'in_progress' ? 'bg-blue-100' : 'bg-gray-200'
                  }`}>
                    <Clock className={`w-4 h-4 ${
                      isAwaitingNoticeService(workflow)
                        ? 'text-amber-700'
                        : workflow.status === 'in_progress' ? 'text-blue-600' : 'text-gray-600'
                    }`} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">
                      {workflowLabel(workflow)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {activeWorkflowLocationLabel(workflow)}
                      {workflow.required_notice_date && ` • Notice due: ${new Date(workflow.required_notice_date).toLocaleDateString()}`}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isAwaitingNoticeService(workflow) && (
                    <span className="px-2 py-1 text-xs rounded bg-amber-100 text-amber-800">
                      Awaiting service
                    </span>
                  )}
                  <span className={`px-2 py-1 text-xs rounded ${
                    workflow.status === 'in_progress' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {workflow.status === 'in_progress' ? 'In Progress' : 'Draft'}
                  </span>
                  <span className="text-xs text-gray-500">
                    Step {workflow.current_step}/{workflow.total_steps}
                  </span>
                  <button
                    type="button"
                    title="Delete workflow"
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    onClick={(e) => {
                      e.stopPropagation();
                      setWorkflowPendingDelete(workflow);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConfirmationModal
        isOpen={Boolean(workflowPendingDelete)}
        onClose={() => !isDeletingWorkflow && setWorkflowPendingDelete(null)}
        onConfirm={handleDeleteWorkflow}
        title="Delete workflow?"
        message={
          workflowPendingDelete
            ? `Delete the ${workflowLabel(workflowPendingDelete)} workflow? This cannot be undone.`
            : ''
        }
        confirmText="Delete"
        isDestructive
        isLoading={isDeletingWorkflow}
      />

      <ConfirmationModal
        isOpen={Boolean(completionNotice)}
        onClose={() => setCompletionNotice(null)}
        onConfirm={() => {
          if (completionNotice?.status === 'success') {
            setCompletionNotice(null);
            setActivePage('Documents');
            return;
          }
          setCompletionNotice(null);
        }}
        title={completionNotice?.title || 'Workflow complete'}
        message={completionNotice?.message || ''}
        confirmText={completionNotice?.status === 'success' ? 'View Documents' : 'OK'}
        cancelText="Close"
        hideCancel={completionNotice?.status === 'pending_service'}
        isDestructive={completionNotice?.status === 'error'}
        isSuccess={
          completionNotice?.status === 'success' ||
          completionNotice?.status === 'pending_service'
        }
      />

      {/* Process Cards Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredProcesses.map(process => {
          const matchingWorkflows = activeWorkflows.filter(
            (workflow) => workflow.workflow_type === process.id
          );
          const activeWorkflow = matchingWorkflows[0] || null;
          const awaitingCount = matchingWorkflows.filter(isAwaitingNoticeService).length;
          const startFresh = GENERATE_THEN_SERVE_WORKFLOW_TYPES.has(process.id);
          return (
            <ComplianceActionCard
              key={process.id}
              process={process}
              activeWorkflow={activeWorkflow}
              awaitingCount={awaitingCount}
              inProgressCount={matchingWorkflows.length}
              startFresh={startFresh}
              onStartWorkflow={() =>
                handleStartWorkflow(
                  process.id,
                  startFresh ? null : activeWorkflow?.workflow_id ?? null
                )
              }
            />
          );
        })}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
        <div className="bg-blue-50 p-4 rounded-lg">
          <p className="text-2xl font-bold text-blue-900">{activeWorkflows.length}</p>
          <p className="text-sm text-blue-700">Active Workflows</p>
        </div>
        <div className="bg-amber-50 p-4 rounded-lg">
          <p className="text-2xl font-bold text-amber-900">
            {activeWorkflows.filter(isAwaitingNoticeService).length}
          </p>
          <p className="text-sm text-amber-800">Awaiting service</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <p className="text-2xl font-bold text-green-900">
            {activeWorkflows.filter(w => w.required_notice_date && new Date(w.required_notice_date) >= new Date()).length}
          </p>
          <p className="text-sm text-green-700">Upcoming Deadlines</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg">
          <p className="text-2xl font-bold text-red-900">
            {activeWorkflows.filter(w => w.required_notice_date && new Date(w.required_notice_date) < new Date()).length}
          </p>
          <p className="text-sm text-red-700">Overdue</p>
        </div>
      </div>

      {/* Info Section */}
      <Card title="About Compliance Center" className="mt-8">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            The Compliance Center uses the Washington State and City of Seattle jurisdiction packs to
            calculate notice periods and guide workflows. Those numbers are pack-dependent reference
            math (RCW 59.18 / SMC overlays), not a substitute for legal counsel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Key Features:</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Automatic jurisdiction detection (Seattle vs. WA State)</li>
                <li>Notice period calculations</li>
                <li>Policy-driven workflows</li>
                <li>Document generation</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Compliance Rules:</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Washington State Residential Landlord-Tenant Act (RCW 59.18)</li>
                <li>Seattle Municipal Code - Rental Regulations</li>
                <li>Fair Housing Act compliance</li>
                <li>FDCPA compliance for collections</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// A reusable component for each action on the compliance page
const ComplianceActionCard = ({
  process,
  activeWorkflow,
  awaitingCount = 0,
  inProgressCount = 0,
  startFresh = false,
  onStartWorkflow,
}) => {
  const priorityColors = {
    high: 'bg-red-100 text-red-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-blue-100 text-blue-800'
  };
  const showResume = Boolean(activeWorkflow) && !startFresh;

  return (
    <Card title="" className="bg-white hover:shadow-lg transition-shadow h-full flex flex-col">
      <div className="flex flex-col h-full p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="p-3 bg-gray-100 rounded-lg">
            {process.icon}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`px-2 py-1 rounded text-xs font-semibold ${priorityColors[process.priority]}`}>
              {process.priority}
            </span>
            {awaitingCount > 0 ? (
              <span className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 bg-amber-100 text-amber-800">
                <Clock className="w-3 h-3" />
                {awaitingCount} awaiting service
              </span>
            ) : inProgressCount > 0 ? (
              <span className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 bg-blue-100 text-blue-800">
                <Clock className="w-3 h-3" />
                {startFresh ? `${inProgressCount} in progress` : 'Active'}
              </span>
            ) : null}
          </div>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-800">{process.title}</h3>
        <p className="text-sm text-gray-600 mb-4 flex-grow">{process.description}</p>
        <button
          onClick={onStartWorkflow}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 flex items-center justify-center gap-2"
        >
          {showResume ? 'Resume Workflow' : 'Start Workflow'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </Card>
  );
};
