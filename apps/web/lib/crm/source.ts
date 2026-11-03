import type { ApiRouteId, RouteBody, RouteQuery, RouteResponse } from '@vistar/shared';
import { isMockData } from '../api/data-source';
import { httpCrmSource } from './http-source';
import { mockCrmSource } from './mock-source';

/**
 * Data source of the CRM modules (contacts, accounts, deals, products and price lists, quotations,
 * invoices and payments, seller profile, calendar, lead routing, lead capture forms, public pages).
 * Method types come straight from the API route contract (`API_ROUTES`), so both sources match it.
 * The HTTP source is the default; the in-memory mock source is only for the test-only mock data mode.
 */
type Res<K extends ApiRouteId> = Promise<RouteResponse<K>>;
/** Query values as callers hold them (booleans and numbers are serialised), like the HTTP client's LooseQuery. */
type Loose<T> = { [P in keyof T]?: T[P] | string | number | boolean | readonly string[] | null };
type Q<K extends ApiRouteId> = Loose<NonNullable<RouteQuery<K>>>;
type B<K extends ApiRouteId> = RouteBody<K>;
export interface PdfFile {
  blob: Blob;
  filename: string | null;
}

export interface CrmSource {
  contacts: {
    list(q: Q<'contactList'>): Res<'contactList'>;
    get(id: string): Res<'contactGet'>;
    create(body: B<'contactCreate'>): Res<'contactCreate'>;
    update(id: string, patch: B<'contactUpdate'>): Res<'contactUpdate'>;
    remove(id: string): Promise<void>;
    bulk(action: B<'contactBulk'>): Res<'contactBulk'>;
    merge(body: B<'contactMerge'>): Res<'contactMerge'>;
    duplicates(id: string): Res<'contactDuplicates'>;
    related(id: string): Res<'contactRelated'>;
    timeline(id: string, cursor: string | null): Res<'contactTimeline'>;
    addNote(id: string, body: string): Res<'contactNoteCreate'>;
  };
  accounts: {
    list(q: Q<'accountList'>): Res<'accountList'>;
    get(id: string): Res<'accountGet'>;
    create(body: B<'accountCreate'>): Res<'accountCreate'>;
    update(id: string, patch: B<'accountUpdate'>): Res<'accountUpdate'>;
    remove(id: string): Promise<void>;
    bulk(action: B<'accountBulk'>): Res<'accountBulk'>;
    merge(body: B<'accountMerge'>): Res<'accountMerge'>;
    duplicates(id: string): Res<'accountDuplicates'>;
    related(id: string): Res<'accountRelated'>;
    timeline(id: string, cursor: string | null): Res<'accountTimeline'>;
    addNote(id: string, body: string): Res<'accountNoteCreate'>;
  };
  deals: {
    pipelines(): Res<'pipelineList'>;
    list(q: Q<'dealList'>): Res<'dealList'>;
    board(q: Q<'dealBoard'>): Res<'dealBoard'>;
    get(id: string): Res<'dealGet'>;
    create(body: B<'dealCreate'>): Res<'dealCreate'>;
    update(id: string, patch: B<'dealUpdate'>): Res<'dealUpdate'>;
    move(id: string, move: B<'dealMove'>): Res<'dealMove'>;
    remove(id: string): Promise<void>;
    bulk(action: B<'dealBulk'>): Res<'dealBulk'>;
    related(id: string): Res<'dealRelated'>;
    timeline(id: string, cursor: string | null): Res<'dealTimeline'>;
    addNote(id: string, body: string): Res<'dealNoteCreate'>;
    convertLead(leadId: string, body: B<'leadConvert'>): Res<'leadConvert'>;
  };
  products: {
    list(q: Q<'productList'>): Res<'productList'>;
    get(id: string): Res<'productGet'>;
    create(body: B<'productCreate'>): Res<'productCreate'>;
    update(id: string, patch: B<'productUpdate'>): Res<'productUpdate'>;
    remove(id: string): Promise<void>;
    priceLists(): Res<'priceListList'>;
    priceList(id: string): Res<'priceListGet'>;
    createPriceList(body: B<'priceListCreate'>): Res<'priceListCreate'>;
    updatePriceList(id: string, patch: B<'priceListUpdate'>): Res<'priceListUpdate'>;
    removePriceList(id: string): Promise<void>;
  };
  billing: {
    profile(): Res<'sellerProfileGet'>;
    saveProfile(body: B<'sellerProfileUpdate'>): Res<'sellerProfileUpdate'>;
  };
  quotations: {
    list(q: Q<'quotationList'>): Res<'quotationList'>;
    get(id: string): Res<'quotationGet'>;
    create(body: B<'quotationCreate'>): Res<'quotationCreate'>;
    update(id: string, patch: B<'quotationUpdate'>): Res<'quotationUpdate'>;
    remove(id: string): Promise<void>;
    setStatus(id: string, body: B<'quotationStatus'>): Res<'quotationStatus'>;
    send(id: string, body: B<'quotationSend'>): Res<'quotationSend'>;
    /** change #20: e-mail with the PDF attached, or WhatsApp with the share link. */
    deliver(id: string, body: B<'quotationDeliver'>): Res<'quotationDeliver'>;
    share(id: string, body: B<'quotationShare'>): Res<'quotationShare'>;
    revokeShare(id: string): Promise<void>;
    pdf(id: string): Promise<PdfFile>;
    convert(id: string): Res<'quotationConvert'>;
    duplicate(id: string): Res<'quotationDuplicate'>;
  };
  invoices: {
    list(q: Q<'invoiceList'>): Res<'invoiceList'>;
    get(id: string): Res<'invoiceGet'>;
    create(body: B<'invoiceCreate'>): Res<'invoiceCreate'>;
    update(id: string, patch: B<'invoiceUpdate'>): Res<'invoiceUpdate'>;
    remove(id: string): Promise<void>;
    issue(id: string, body: B<'invoiceIssue'>): Res<'invoiceIssue'>;
    cancel(id: string, body: B<'invoiceCancel'>): Res<'invoiceCancel'>;
    send(id: string, body: B<'invoiceSend'>): Res<'invoiceSend'>;
    /** change #20: e-mail with the PDF attached, or WhatsApp with the share link. */
    deliver(id: string, body: B<'invoiceDeliver'>): Res<'invoiceDeliver'>;
    share(id: string, body: B<'invoiceShare'>): Res<'invoiceShare'>;
    revokeShare(id: string): Promise<void>;
    pdf(id: string): Promise<PdfFile>;
    recordPayment(id: string, body: B<'paymentCreate'>): Res<'paymentCreate'>;
    deletePayment(id: string, paymentId: string): Res<'paymentDelete'>;
  };
  calendar: {
    meetings(q: NonNullable<RouteQuery<'meetingList'>>): Res<'meetingList'>;
    get(id: string): Res<'meetingGet'>;
    create(body: B<'meetingCreate'>): Res<'meetingCreate'>;
    update(id: string, patch: B<'meetingUpdate'>): Res<'meetingUpdate'>;
    cancel(id: string, body: B<'meetingCancel'>): Res<'meetingCancel'>;
    respond(id: string, body: B<'meetingRespond'>): Res<'meetingRespond'>;
    remove(id: string): Promise<void>;
    availability(q: NonNullable<RouteQuery<'calendarAvailability'>>): Res<'calendarAvailability'>;
    timeOff(q: Q<'timeOffList'>): Res<'timeOffList'>;
    createTimeOff(body: B<'timeOffCreate'>): Res<'timeOffCreate'>;
    deleteTimeOff(id: string): Promise<void>;
  };
  routing: {
    list(): Res<'routingRuleList'>;
    create(body: B<'routingRuleCreate'>): Res<'routingRuleCreate'>;
    update(id: string, patch: B<'routingRuleUpdate'>): Res<'routingRuleUpdate'>;
    remove(id: string): Promise<void>;
    reorder(ids: string[]): Res<'routingRuleOrder'>;
    test(body: B<'routingTest'>): Res<'routingTest'>;
  };
  capture: {
    list(): Res<'captureFormList'>;
    get(id: string): Res<'captureFormGet'>;
    create(body: B<'captureFormCreate'>): Res<'captureFormCreate'>;
    update(id: string, patch: B<'captureFormUpdate'>): Res<'captureFormUpdate'>;
    remove(id: string): Promise<void>;
    submissions(id: string, cursor: string | null): Res<'captureSubmissionList'>;
  };
  /** No sign-in: hosted form and shared document pages. */
  public: {
    form(key: string): Res<'publicCaptureFormGet'>;
    submit(key: string, body: B<'publicCaptureFormSubmit'>): Res<'publicCaptureFormSubmit'>;
    document(token: string): Res<'publicDocumentGet'>;
    documentPdf(token: string): Promise<PdfFile>;
  };
}

export function getCrmSource(): CrmSource {
  return isMockData() ? mockCrmSource : httpCrmSource;
}
