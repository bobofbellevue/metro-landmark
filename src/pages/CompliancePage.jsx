import React, { useState, useContext, useEffect, useMemo, useRef } from 'react';
import { 
  Shield, FileText, Banknote, ArrowRight, 
  UserCheck, Calendar, AlertTriangle, Key, DoorOpen,
  DollarSign, Gavel, Wrench,
  Lock, Search, TrendingUp, Clock, Trash2, X
} from 'lucide-react';
import { AuthContext, SidebarContext } from '../contexts';
import { Card, ConfirmationModal } from '../components/ui';
import { supabase } from '../lib/supabase';
import { readResponseJson } from '../utils/read-response-json.js';
import { isAwaitingNoticeService, GENERATE_THEN_SERVE_WORKFLOW_TYPES } from '../utils/notice-service-workflow.js';
import { hydrateWorkflowData } from '../utils/compliance-workflow-persistence.js';
import {
  COMPLIANCE_LIFECYCLE_STAGES,
  complianceWorkflowCardId,
  formatComplianceWorkflowNumber,
  labeledComplianceWorkflow,
  pickComplianceWorkflowForJump,
  searchComplianceWorkflows,
} from '../config/compliance-workflows.js';
import {
  PAGE_SEARCH_KEYS,
  readPageSearchSession,
  writePageSearchSession,
} from '../utils/page-search-session.js';
import {
  ACTIVE_WORKFLOW_LIST_SELECT,
  activeWorkflowLocationLabel,
} from '../utils/workflow-lease-context.js';

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

const WORKFLOW_ICONS = {
  tenant_screening: <UserCheck className="w-8 h-8 text-teal-500" />,
  move_in: <Key className="w-8 h-8 text-purple-500" />,
  entry_notice: <Lock className="w-8 h-8 text-indigo-500" />,
  rent_increase: <TrendingUp className="w-8 h-8 text-blue-500" />,
  lease_renewal: <Calendar className="w-8 h-8 text-green-500" />,
  habitability: <Wrench className="w-8 h-8 text-blue-500" />,
  lease_violation: <AlertTriangle className="w-8 h-8 text-yellow-500" />,
  collections: <DollarSign className="w-8 h-8 text-red-500" />,
  lease_termination: <FileText className="w-8 h-8 text-gray-500" />,
  eviction: <Gavel className="w-8 h-8 text-red-500" />,
  move_out: <DoorOpen className="w-8 h-8 text-orange-500" />,
  security_deposit: <Banknote className="w-8 h-8 text-green-500" />,
};

// This is the main component for the Compliance page
export default function CompliancePage() {
  const { user } = useContext(AuthContext);
  const { setActivePage } = useContext(SidebarContext);
  const [searchTerm, setSearchTerm] = useState(() =>
    readPageSearchSession(PAGE_SEARCH_KEYS.compliance, user?.user_id, {
      searchTerm: '',
    }).searchTerm
  );
  const [highlightedWorkflowId, setHighlightedWorkflowId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [selectedWorkflowRecord, setSelectedWorkflowRecord] = useState(null);
  const [activeWorkflows, setActiveWorkflows] = useState([]);
  const [, setIsLoadingWorkflows] = useState(true);
  const [workflowPendingDelete, setWorkflowPendingDelete] = useState(null);
  const [isDeletingWorkflow, setIsDeletingWorkflow] = useState(false);
  const [completionNotice, setCompletionNotice] = useState(null);

  const matchedWorkflows = useMemo(
    () => searchComplianceWorkflows(searchTerm),
    [searchTerm]
  );

  const workflowsByStage = useMemo(() => {
    return COMPLIANCE_LIFECYCLE_STAGES.map((stage) => ({
      ...stage,
      workflows: matchedWorkflows.filter((item) => item.stage === stage.id),
    })).filter((stage) => stage.workflows.length > 0);
  }, [matchedWorkflows]);

  useEffect(() => {
    fetchActiveWorkflows();
  }, []);

  useEffect(() => {
    if (user?.user_id) {
      writePageSearchSession(PAGE_SEARCH_KEYS.compliance, user.user_id, {
        searchTerm,
      });
    }
  }, [searchTerm, user?.user_id]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
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

  const highlightWorkflow = (workflowId) => {
    setHighlightedWorkflowId(workflowId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedWorkflowId(null), 1800);
  };

  const scrollToWorkflow = (item) => {
    if (!item) return;
    const el = document.getElementById(complianceWorkflowCardId(item.id));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    highlightWorkflow(item.id);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const jump = pickComplianceWorkflowForJump(searchTerm, matchedWorkflows);
    scrollToWorkflow(jump || matchedWorkflows[0] || null);
    setSearchOpen(false);
  };

  const handleWorkflowComplete = (_data, generationResult = null) => {
    fetchActiveWorkflows();
    if (generationResult?.nextProcess) {
      setCompletionNotice(null);
      setSelectedProcess(generationResult.nextProcess);
      setSelectedWorkflowId(null);
      setSelectedWorkflowRecord({
        workflow_data: generationResult.nextInitialData || {},
      });
      return;
    }
    setSelectedProcess(null);
    setSelectedWorkflowId(null);
    setSelectedWorkflowRecord(null);
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

  const workflowLabel = (workflow) =>
    labeledComplianceWorkflow(workflow.workflow_type) || workflow.workflow_type;

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

      {/* Workflow search */}
      <form onSubmit={handleSearchSubmit} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setSearchOpen(true);
            }}
            placeholder="Find a workflow by number, name, or description"
            aria-label="Find a workflow by number, name, or description"
            className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSearchOpen(false), 150);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear workflow search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {searchTerm.trim() && searchOpen && matchedWorkflows.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
            {matchedWorkflows.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-start gap-3"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    scrollToWorkflow(item);
                    setSearchOpen(false);
                  }}
                >
                  <span className="font-mono text-sm font-semibold text-indigo-700 w-8 shrink-0">
                    {formatComplianceWorkflowNumber(item.number)}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{item.title}</span>
                    <span className="block text-xs text-gray-500 line-clamp-1">{item.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {/* Active Workflows Section */}
      {activeWorkflows.length > 0 && (
        <Card title="Active Workflows" className="mb-6">
          <div className="finder-list space-y-3 max-h-[13.5rem] overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
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
        reverseActionOrder={completionNotice?.status === 'success'}
        isDestructive={completionNotice?.status === 'error'}
        isSuccess={
          completionNotice?.status === 'success' ||
          completionNotice?.status === 'pending_service'
        }
      />

      {/* Process cards in tenancy lifecycle order */}
      {matchedWorkflows.length === 0 ? (
        <p className="text-sm text-gray-600">
          No workflows match &quot;{searchTerm.trim()}&quot;.
        </p>
      ) : (
        <div className="space-y-8">
          {workflowsByStage.map((stage) => (
            <section key={stage.id}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                {stage.label}
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {stage.workflows.map((process) => {
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
                      highlighted={highlightedWorkflowId === process.id}
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
            </section>
          ))}
        </div>
      )}

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
  highlighted = false,
  activeWorkflow,
  awaitingCount = 0,
  inProgressCount = 0,
  startFresh = false,
  onStartWorkflow,
}) => {
  const showResume = Boolean(activeWorkflow) && !startFresh;
  const number = formatComplianceWorkflowNumber(process.number);

  return (
    <Card
      title=""
      className={`bg-white hover:shadow-lg transition-shadow h-full flex flex-col ${
        highlighted ? 'ring-2 ring-indigo-500' : ''
      }`}
    >
      <div
        id={complianceWorkflowCardId(process.id)}
        className="flex flex-col h-full p-4 scroll-mt-4"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 rounded-lg">
              {WORKFLOW_ICONS[process.id]}
            </div>
            <span className="font-mono text-lg font-semibold text-indigo-700">
              {number}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
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
