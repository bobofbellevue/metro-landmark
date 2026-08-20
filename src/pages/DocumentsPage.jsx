import React, { useState, useEffect, useContext, useRef } from 'react';
import { FileText, Search, Download, Archive, Eye, RotateCcw, CheckSquare, Square, ChevronLeft, ChevronRight, ArrowUpDown, RotateCw } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card } from '../components/ui';
import DocumentPreview from '../components/DocumentPreview';
import DocumentArchiveModal from '../components/DocumentArchiveModal';
import {
  buildDocumentTypeFilterOptions,
  formatDocumentTypeLabel,
} from '../config/document-types.js';
import {
  DOCUMENT_LIST_SELECT,
  attachDocumentEntityParties,
  documentEntityLines,
  documentLandlordId,
  formatDocumentEntityLabel,
  indexContactsById,
  tenantNamesByLeaseId,
  uniqueIds,
} from '../utils/document-entity-label.js';
import {
  fetchLeaseClientTenantRefs,
  leaseTenantContactableIds,
} from '../utils/lease-tenants.js';

export default function DocumentsPage() {
  const { user } = useContext(AuthContext);
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // all, signed, unsigned
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortBy, setSortBy] = useState('date'); // date, type, status, name
  const [sortOrder, setSortOrder] = useState('desc'); // asc, desc
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [actionError, setActionError] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [discoveredTypes, setDiscoveredTypes] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTargets, setArchiveTargets] = useState(null);
  const rowClickTimerRef = useRef(null);

  useEffect(() => {
    if (user) {
      fetchDocuments();
    }
  }, [user, filterType, filterStatus, showArchived]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('documents').select('document_type');
      if (cancelled || !data) return;
      setDiscoveredTypes([
        ...new Set(data.map((d) => d.document_type).filter(Boolean)),
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const applyFilters = (query) => {
        if (!showArchived) {
          query = query.or('is_archived.is.null,is_archived.eq.false');
        }
        if (filterType !== 'all') {
          query = query.eq('document_type', filterType);
        }
        if (filterStatus === 'signed') {
          query = query.eq('is_signed', true);
        } else if (filterStatus === 'unsigned') {
          query = query.eq('is_signed', false);
        }
        if (filterDateFrom) {
          query = query.gte('created_at', filterDateFrom);
        }
        if (filterDateTo) {
          query = query.lte('created_at', filterDateTo);
        }
        const orderColumn =
          sortBy === 'date'
            ? 'created_at'
            : sortBy === 'type'
              ? 'document_type'
              : sortBy === 'status'
                ? 'is_signed'
                : 'file_name';
        return query.order(orderColumn, { ascending: sortOrder === 'asc' });
      };

      let { data, error } = await applyFilters(
        supabase.from('documents').select(DOCUMENT_LIST_SELECT)
      );
      if (error) {
        console.warn(
          'Documents nested select failed, retrying without joins:',
          error.message || error
        );
        ({ data, error } = await applyFilters(
          supabase.from('documents').select('*')
        ));
      }

      if (error) {
        console.error('Error fetching documents:', error);
        setDocuments([]);
      } else {
        const rows = data || [];
        const leaseIds = uniqueIds(rows.map((doc) => doc.lease_id));
        const landlordIds = uniqueIds(rows.map((doc) => documentLandlordId(doc)));
        const tenantUserIds = uniqueIds(rows.map((doc) => doc.tenant_user_id));

        let tenantsByLeaseId = {};
        if (leaseIds.length > 0) {
          const leaseTenantRefs = await fetchLeaseClientTenantRefs(
            supabase,
            leaseIds
          );
          const contactableIds = leaseTenantContactableIds(leaseTenantRefs);
          let clientContacts = [];
          if (contactableIds.length > 0) {
            const { data: contactRows, error: tenantContactError } = await supabase
              .from('contacts')
              .select('contactable_id, first_name, middle_name, last_name')
              .eq('contactable_type', 'client')
              .in('contactable_id', contactableIds);
            if (tenantContactError) {
              console.warn(
                'Documents tenant contacts select failed:',
                tenantContactError.message || tenantContactError
              );
            }
            clientContacts = contactRows || [];
          }
          tenantsByLeaseId = tenantNamesByLeaseId(
            leaseTenantRefs,
            clientContacts
          );
        }

        let landlordContactsById = {};
        if (landlordIds.length > 0) {
          const { data: landlordContacts } = await supabase
            .from('contacts')
            .select('contactable_id, first_name, middle_name, last_name')
            .eq('contactable_type', 'landlord')
            .in('contactable_id', landlordIds);
          landlordContactsById = indexContactsById(landlordContacts || []);
        }

        let tenantContactsByUserId = {};
        if (tenantUserIds.length > 0) {
          // TenantsPage stores tenant contacts as type=client, contactable_id=user_id.
          const { data: clientByUser } = await supabase
            .from('contacts')
            .select('contactable_id, first_name, middle_name, last_name')
            .eq('contactable_type', 'client')
            .in('contactable_id', tenantUserIds);
          tenantContactsByUserId = indexContactsById(clientByUser || []);
          const found = new Set(Object.keys(tenantContactsByUserId));
          const missing = tenantUserIds.filter((id) => !found.has(String(id)));
          if (missing.length > 0) {
            const { data: userContacts } = await supabase
              .from('contacts')
              .select('contactable_id, first_name, middle_name, last_name')
              .eq('contactable_type', 'user')
              .in('contactable_id', missing);
            Object.assign(
              tenantContactsByUserId,
              indexContactsById(userContacts || [])
            );
          }
          const stillMissing = tenantUserIds.filter(
            (id) => !tenantContactsByUserId[String(id)]
          );
          if (stillMissing.length > 0) {
            const { data: clients } = await supabase
              .from('clients')
              .select('client_id, user_id')
              .in('user_id', stillMissing);
            const clientIds = uniqueIds(
              (clients || []).map((client) => client.client_id)
            );
            if (clientIds.length > 0) {
              const { data: clientContacts } = await supabase
                .from('contacts')
                .select('contactable_id, first_name, middle_name, last_name')
                .eq('contactable_type', 'client')
                .in('contactable_id', clientIds);
              const userIdByClientId = new Map(
                (clients || []).map((client) => [
                  String(client.client_id),
                  client.user_id,
                ])
              );
              for (const contact of clientContacts || []) {
                const userId = userIdByClientId.get(String(contact.contactable_id));
                if (userId != null) {
                  tenantContactsByUserId[String(userId)] = contact;
                }
              }
            }
          }
        }

        setDocuments(
          attachDocumentEntityParties(rows, {
            tenantsByLeaseId,
            landlordContactsById,
            tenantContactsByUserId,
          })
        );
        setCurrentPage(1);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredDocuments = documents.filter(doc => {
    if (!searchTerm.trim()) return true;
    const searchLower = searchTerm.toLowerCase();
    const entityLabel = formatDocumentEntityLabel(doc).toLowerCase();
    return (
      doc.file_name?.toLowerCase().includes(searchLower) ||
      doc.document_type?.toLowerCase().includes(searchLower) ||
      entityLabel.includes(searchLower)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredDocuments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedDocuments = filteredDocuments.slice(startIndex, endIndex);

  // Bulk operations
  const handleSelectAll = () => {
    if (selectedDocuments.size === paginatedDocuments.length) {
      setSelectedDocuments(new Set());
    } else {
      setSelectedDocuments(new Set(paginatedDocuments.map(d => d.document_id)));
    }
  };

  const handleSelectDocument = (documentId) => {
    const newSelected = new Set(selectedDocuments);
    if (newSelected.has(documentId)) {
      newSelected.delete(documentId);
    } else {
      newSelected.add(documentId);
    }
    setSelectedDocuments(newSelected);
  };

  const openArchiveForIds = (ids) => {
    const selected = documents.filter(
      (d) => ids.has(d.document_id) || ids.has(String(d.document_id))
    );
    if (selected.length > 0) setArchiveTargets(selected);
  };

  const getSelectedDocumentList = () =>
    documents.filter(
      (d) =>
        selectedDocuments.has(d.document_id) ||
        selectedDocuments.has(String(d.document_id))
    );

  const selectedDocumentList = getSelectedDocumentList();
  const selectedAreArchived =
    selectedDocumentList.length > 0 &&
    selectedDocumentList.every((d) => d.is_archived);

  const handleBulkArchive = () => {
    if (selectedDocuments.size === 0) return;
    openArchiveForIds(selectedDocuments);
  };

  const handleBulkActivate = async () => {
    const docs = getSelectedDocumentList().filter((d) => d.is_archived);
    if (docs.length === 0) return;

    setActionError('');
    try {
      const results = await Promise.all(
        docs.map((doc) =>
          fetch(`/api/documents/${doc.document_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unarchive' }),
          }).then((res) => res.json())
        )
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setActionError(
          failed[0].error || `Failed to activate ${failed.length} document(s)`
        );
        return;
      }
      setSelectedDocuments(new Set());
      fetchDocuments();
    } catch (error) {
      console.error('Error activating documents:', error);
      setActionError(error.message || 'Failed to activate documents.');
    }
  };

  const archiveDocuments = async (docs, reason) => {
    setActionError('');
    const results = await Promise.all(
      docs.map((doc) =>
        fetch(`/api/documents/${doc.document_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'archive',
            archive_reason: reason,
            archived_by_user_id: user?.user_id || null,
          }),
        }).then((res) => res.json())
      )
    );
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      throw new Error(failed[0].error || `Failed to archive ${failed.length} document(s)`);
    }
    setSelectedDocuments(new Set());
    fetchDocuments();
  };

  const permanentlyDeleteDocuments = async (docs) => {
    setActionError('');
    const results = await Promise.all(
      docs.map((doc) =>
        fetch(`/api/documents/${doc.document_id}`, { method: 'DELETE' }).then((res) =>
          res.json()
        )
      )
    );
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      throw new Error(failed[0].error || `Failed to delete ${failed.length} document(s)`);
    }
    setSelectedDocuments(new Set());
    fetchDocuments();
  };

  const handleUnarchive = async (doc) => {
    setActionError('');
    try {
      const response = await fetch(`/api/documents/${doc.document_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unarchive' }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to restore document');
      }
      fetchDocuments();
    } catch (error) {
      console.error('Error restoring document:', error);
      setActionError(error.message || 'Failed to restore document.');
    }
  };

  const handleBulkDownload = async () => {
    if (selectedDocuments.size === 0) return;

    setActionError('');
    try {
      // Open each document in a new tab for download
      for (const id of selectedDocuments) {
        const response = await fetch(`/api/documents/${id}/download`);
        const result = await response.json();
        if (result.success) {
          window.open(result.url, '_blank');
        }
      }
    } catch (error) {
      console.error('Error bulk downloading:', error);
      setActionError('Failed to download some documents.');
    }
  };

  const handleRegenerate = async (document) => {
    if (!confirm('Are you sure you want to regenerate this document? This will create a new version.')) {
      return;
    }

    setActionError('');
    try {
      // Determine document type from metadata or document_type
      const docType = document.metadata?.generated_type || 
                     (document.document_type?.includes('lease') ? 'lease' : null);
      
      if (!docType || docType !== 'lease') {
        setActionError('Regeneration is only available for generated lease documents.');
        return;
      }

      // Get lease_id from document
      const leaseId = document.lease_id;
      if (!leaseId) {
        setActionError('Cannot regenerate: missing lease ID.');
        return;
      }

      // Use user_id from AuthContext (integer from users table)
      // The uploaded_by_user_id field expects an integer user_id, not a UUID
      const userId = user?.user_id || null;

      const response = await fetch('/api/documents/generate/lease', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lease_id: leaseId,
          template_id: document.metadata?.template_id,
          user_id: userId
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to regenerate document');
      }

      // Refresh documents list
      fetchDocuments();
    } catch (error) {
      console.error('Error regenerating document:', error);
      setActionError(`Failed to regenerate document: ${error.message}`);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleArchiveOne = (doc) => {
    setArchiveTargets([doc]);
  };

  const handleView = (document) => {
    setSelectedDocument(document);
  };

  const handleDownload = async (doc) => {
    setActionError('');
    try {
      const response = await fetch(`/api/documents/${doc.document_id}/download`);
      const result = await response.json();
      if (result.success) {
        window.open(result.url, '_blank');
      } else {
        setActionError(result.error || 'Failed to download document.');
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      setActionError('Failed to download document.');
    }
  };

  const handleRowClick = (doc) => {
    if (rowClickTimerRef.current) {
      clearTimeout(rowClickTimerRef.current);
    }
    rowClickTimerRef.current = setTimeout(() => {
      handleView(doc);
      rowClickTimerRef.current = null;
    }, 250);
  };

  const handleRowDoubleClick = (doc, event) => {
    event.preventDefault();
    if (rowClickTimerRef.current) {
      clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    }
    handleDownload(doc);
  };

  const documentTypeOptions = buildDocumentTypeFilterOptions(discoveredTypes);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Documents</h1>
        <p className="mt-2 text-sm text-gray-600">
          Cross-entity document registry for staff. Entity-specific views (leases, applications,
          maintenance, portals) continue to use contextual document panels. Template source files
          are stored as &quot;Template Source File&quot;; the template kind (Application, Lease, …) lives on
          the template record itself.
        </p>
      </div>

      {actionError && (
        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {actionError}
          <button
            onClick={() => setActionError('')}
            className="ml-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters and Search */}
      <Card className="bg-white p-4">
        <div className="space-y-4">
          {/* Search and Quick Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Document Type Filter */}
            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="all">All Document Types</option>
                {documentTypeOptions.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="all">Signature Status</option>
                <option value="signed">Signed</option>
                <option value="unsigned">Unsigned</option>
              </select>
            </div>
          </div>

          {/* Advanced Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Date From */}
            <div>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                placeholder="From Date"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Date To */}
            <div>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                placeholder="To Date"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Sort */}
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
                <option value="type">Sort by Type</option>
                <option value="status">Sort by Status</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                <ArrowUpDown className="w-5 h-5" />
              </button>
            </div>

            <label className="flex items-center gap-2 px-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Show Archived
            </label>
          </div>
        </div>
      </Card>

      {/* Bulk Actions */}
      {selectedDocuments.size > 0 && (
        <Card className="bg-blue-50 border-blue-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              {selectedDocuments.size} document(s) selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleBulkDownload}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Download className="w-4 h-4 inline mr-1" />
                Download Selected
              </button>
              {selectedAreArchived ? (
                <button
                  onClick={handleBulkActivate}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  <RotateCw className="w-4 h-4 inline mr-1" />
                  Activate Selected
                </button>
              ) : (
                <button
                  onClick={handleBulkArchive}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  <Archive className="w-4 h-4 inline mr-1" />
                  Archive Selected
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Documents List */}
      <Card className="bg-white">
        {filteredDocuments.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>No documents found.</p>
            {searchTerm || filterType !== 'all' || filterStatus !== 'all' ? (
              <p className="mt-2 text-sm">Try adjusting your filters.</p>
            ) : (
              <p className="mt-2 text-sm">Documents will appear here once uploaded.</p>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      <button
                        onClick={handleSelectAll}
                        className="text-gray-400 hover:text-gray-600"
                        title="Select All"
                      >
                        {selectedDocuments.size === paginatedDocuments.length && paginatedDocuments.length > 0 ? (
                          <CheckSquare className="w-5 h-5" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      File Name
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Entity
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Uploaded
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedDocuments.map((doc) => (
                    <tr
                      key={doc.document_id}
                      className={`hover:bg-gray-50 cursor-pointer ${doc.is_archived ? 'opacity-60' : ''}`}
                      onClick={() => handleRowClick(doc)}
                      onDoubleClick={(e) => handleRowDoubleClick(doc, e)}
                      title="Click to view · Double-click to download"
                    >
                      <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleSelectDocument(doc.document_id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {selectedDocuments.has(doc.document_id) ? (
                            <CheckSquare className="w-5 h-5" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-left text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-start gap-2">
                          <button
                            onClick={() => handleView(doc)}
                            className="text-indigo-600 hover:text-indigo-900"
                            title="View"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDownload(doc)}
                            className="text-blue-600 hover:text-blue-900"
                            title="Download"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          {doc.metadata?.generated_type && (
                            <button
                              onClick={() => handleRegenerate(doc)}
                              className="text-purple-600 hover:text-purple-900"
                              title="Regenerate"
                            >
                              <RotateCcw className="w-5 h-5" />
                            </button>
                          )}
                          {doc.is_archived ? (
                            <button
                              onClick={() => handleUnarchive(doc)}
                              className="text-green-600 hover:text-green-900"
                              title="Restore"
                            >
                              <RotateCw className="w-5 h-5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchiveOne(doc)}
                              className="text-red-600 hover:text-red-900"
                              title="Archive"
                            >
                              <Archive className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="w-5 h-5 text-gray-400 mr-2" />
                          <span className="text-sm font-medium text-gray-900">{doc.file_name}</span>
                          {doc.is_archived && (
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                              Archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded">
                          {formatDocumentTypeLabel(doc.document_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <DocumentEntityCell doc={doc} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                        {formatFileSize(doc.file_size)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {doc.is_signed ? (
                          <span className="px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full">
                            Signed
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium text-gray-800 bg-gray-100 rounded-full">
                            Unsigned
                          </span>
                        )}
                        {doc.metadata?.processing_status && (
                          <div className="mt-1">
                            <span className={`px-2 py-1 text-xs rounded ${
                              doc.metadata.processing_status === 'completed' ? 'bg-green-100 text-green-800' :
                              doc.metadata.processing_status === 'processing' ? 'bg-blue-100 text-blue-800' :
                              doc.metadata.processing_status === 'error' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {doc.metadata.processing_status}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(doc.uploaded_at || doc.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredDocuments.length)} of {filteredDocuments.length} documents
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    <ChevronLeft className="w-4 h-4 inline" />
                  </button>
                  <span className="px-3 py-1 text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    <ChevronRight className="w-4 h-4 inline" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Document Preview Modal */}
      {selectedDocument && (
        <DocumentPreview
          document={selectedDocument}
          isOpen={!!selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onDownload={(doc) => handleDownload(doc)}
        />
      )}

      {archiveTargets && archiveTargets.length > 0 && (
        <DocumentArchiveModal
          documents={archiveTargets}
          onClose={() => setArchiveTargets(null)}
          onArchive={archiveDocuments}
          onPermanentDelete={permanentlyDeleteDocuments}
          isAdmin={['global_admin', 'company_admin', 'manager'].includes(user?.role)}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white p-4">
          <div className="text-sm font-medium text-gray-600">Total Documents</div>
          <div className="text-2xl font-bold text-gray-900">{documents.length}</div>
        </Card>
        <Card className="bg-white p-4">
          <div className="text-sm font-medium text-gray-600">Signed</div>
          <div className="text-2xl font-bold text-green-600">
            {documents.filter(d => d.is_signed).length}
          </div>
        </Card>
        <Card className="bg-white p-4">
          <div className="text-sm font-medium text-gray-600">Unsigned</div>
          <div className="text-2xl font-bold text-gray-600">
            {documents.filter(d => !d.is_signed).length}
          </div>
        </Card>
        <Card className="bg-white p-4">
          <div className="text-sm font-medium text-gray-600">Total Size</div>
          <div className="text-2xl font-bold text-gray-900">
            {formatFileSize(documents.reduce((sum, d) => sum + (d.file_size || 0), 0))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function DocumentEntityCell({ doc }) {
  const lines = documentEntityLines(doc);
  if (lines.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  return (
    <div className="min-w-[12rem] max-w-[20rem] space-y-1.5 text-sm text-gray-900">
      {lines.map((line) => (
        <div key={line.role} className="break-words whitespace-normal">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {line.role}
          </div>
          <div>{line.label}</div>
        </div>
      ))}
    </div>
  );
}
