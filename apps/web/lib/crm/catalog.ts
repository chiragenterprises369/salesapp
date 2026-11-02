'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PriceListUpdate, ProductListQuery, ProductUpdate, RouteBody, SellerProfile } from '@vistar/shared';
import { useMe } from '../session/session';
import { crmKeys } from './keys';
import { getCrmSource } from './source';

/** Products, price lists and the seller (GST and billing) profile. */
const src = () => getCrmSource();

export type ProductQuery = Partial<Omit<ProductListQuery, 'cursor' | 'limit'>>;

export function useProducts(q: ProductQuery, opts: { enabled?: boolean; limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.products.list({ ...q, limit: opts.limit ?? 50 }),
    queryFn: ({ pageParam }) => src().products.list({ ...q, limit: opts.limit ?? 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useProduct(id: string | null) {
  return useQuery({ queryKey: crmKeys.products.detail(id ?? ''), queryFn: () => src().products.get(id!), enabled: !!id });
}

export function useProductMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.products.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'productCreate'>) => src().products.create(body), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: ProductUpdate }) => src().products.update(id, patch), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => src().products.remove(id), onSuccess: refresh }),
  };
}

export function usePriceLists(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: crmKeys.products.priceLists(), queryFn: () => src().products.priceLists(), enabled: opts.enabled ?? true });
}

export function usePriceList(id: string | null) {
  return useQuery({ queryKey: crmKeys.products.priceList(id ?? ''), queryFn: () => src().products.priceList(id!), enabled: !!id });
}

export function usePriceListMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.products.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'priceListCreate'>) => src().products.createPriceList(body), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: PriceListUpdate }) => src().products.updatePriceList(id, patch), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => src().products.removePriceList(id), onSuccess: refresh }),
  };
}

/** Seller profile (GET /billing/profile is open to every signed-in role: editors need the state code). */
export function useSellerProfile() {
  const me = useMe();
  return useQuery({ queryKey: crmKeys.billing.profile(), queryFn: () => src().billing.profile(), enabled: !!me, staleTime: 5 * 60_000 });
}

export function useSaveSellerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RouteBody<'sellerProfileUpdate'> | SellerProfile) => src().billing.saveProfile(body),
    onSuccess: (res) => qc.setQueryData(crmKeys.billing.profile(), res),
  });
}
