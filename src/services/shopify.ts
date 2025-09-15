// Shopify Storefront API client using @shopify/storefront-api-client
// Expects env vars:
//  VITE_SHOPIFY_STORE_DOMAIN (e.g. yourshop.myshopify.com)
//  VITE_SHOPIFY_STOREFRONT_TOKEN (Storefront API public token)
// Only public product data is fetched; no checkout mutations here.
import { createStorefrontApiClient } from '@shopify/storefront-api-client';

export interface ShopifyProductVariant {
  id: string;
  title: string;
  price: { amount: string; currencyCode: string };
}
export interface ShopifyProductImage { url: string; altText?: string | null; }
export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  images: ShopifyProductImage[];
  variants: ShopifyProductVariant[];
}

interface StorefrontResponse<T> { data?: T; errors?: { message: string }[] }

const DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || 'store.afro-future.app';
const TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
const API_VERSION = (import.meta as any)?.env?.VITE_SHOPIFY_STOREFRONT_API_VERSION || '2025-07';
// DEBUG flag for verbose client errors
const DEBUG = (import.meta as any)?.env?.VITE_SHOPIFY_DEBUG === 'true';
const IS_MYSHOPIFY = /\.myshopify\.com$/i.test(String(DOMAIN));

const PRODUCTS_QUERY = `#graphql
query Products($first:Int!) {
  products(first:$first) {
    edges { node { id handle title description
      images(first:4) { edges { node { url altText } } }
      variants(first:4) { edges { node { id title price: priceV2 { amount currencyCode } } } }
    } }
  }
}`;

export async function fetchProducts(limit = 12): Promise<ShopifyProduct[]> {
  if(!DOMAIN || !TOKEN) throw new Error('missing_shopify_env');
  // Guard against using an Admin token on the Storefront API; admin tokens start with 'shpat_'
  if (typeof TOKEN === 'string' && TOKEN.startsWith('shpat_')) {
    throw new Error('Invalid token for Storefront API: received an Admin token (shpat_...). Please use a Storefront public access token instead.');
  }
  const client = createStorefrontApiClient({ storeDomain: DOMAIN, apiVersion: API_VERSION, publicAccessToken: TOKEN });
  let resp: StorefrontResponse<{products:{edges:{node:any}[]}}> | undefined;
  try {
    resp = await client.request(PRODUCTS_QUERY, { variables: { first: limit } }) as StorefrontResponse<{ products: { edges: { node: any }[] } }>;
  } catch (e: any) {
    const status = e?.response?.status ?? e?.status;
    const base = e?.message ? String(e.message) : 'Unknown Storefront client error';
    const hint = status === 401 ? ' (check Storefront token and store domain)' : '';
    if (DEBUG) {
      const endpoint = `https://${DOMAIN}/api/${API_VERSION}/graphql.json`;
      // eslint-disable-next-line no-console
      console.error('Shopify Storefront request failed', {
        status,
        message: base,
        domain: DOMAIN,
        apiVersion: API_VERSION,
        endpoint,
        tokenPrefix: typeof TOKEN === 'string' ? `${TOKEN.slice(0, 4)}…` : undefined,
        raw: e,
      });
    }
    const domainTip = IS_MYSHOPIFY ? '' : ' If using a custom domain, set VITE_SHOPIFY_STORE_DOMAIN to your <shop>.myshopify.com domain.';
    throw new Error(`Shopify Storefront${status ? ' ' + status : ''}: ${base}${hint}. Ensure VITE_SHOPIFY_STORE_DOMAIN points to your shop (often <shop>.myshopify.com) and the token is a Storefront public access token for that shop.${domainTip}`);
  }
  const { data, errors } = resp ?? {} as any;
  const errs = Array.isArray(errors) ? errors : (errors ? [errors as any] : []);
  if (errs.length) {
    if (DEBUG) {
      const endpoint = `https://${DOMAIN}/api/${API_VERSION}/graphql.json`;
      // eslint-disable-next-line no-console
      console.error('Shopify Storefront GraphQL errors', {
        endpoint,
        domain: DOMAIN,
        messages: errs.map((e:any)=> e?.message ?? String(e)),
        variables: { first: limit },
      });
    }
    throw new Error(errs.map((e:any)=> e?.message ?? String(e)).join('; '));
  }

  const edges = Array.isArray((data as any)?.products?.edges) ? (data as any).products.edges : [];
  const products: ShopifyProduct[] = edges.map((e:any) => {
    const node = e?.node ?? {};
    const imageEdges = Array.isArray(node?.images?.edges) ? node.images.edges : [];
    const variantEdges = Array.isArray(node?.variants?.edges) ? node.variants.edges : [];
    const images = imageEdges
      .map((ie:any) => ({ url: ie?.node?.url ?? '', altText: ie?.node?.altText }))
      .filter((img:any) => !!img.url);
    const variants = variantEdges
      .map((ve:any) => ({
        id: String(ve?.node?.id ?? ''),
        title: ve?.node?.title ?? '',
        price: {
          amount: String(ve?.node?.price?.amount ?? ''),
          currencyCode: ve?.node?.price?.currencyCode ?? ''
        }
      }))
      .filter((v:any) => !!v.id);
    return {
      id: String(node?.id ?? ''),
      handle: node?.handle ?? '',
      title: node?.title ?? '',
      description: node?.description ?? '',
      images,
      variants,
    } as ShopifyProduct;
  }).filter((p:any) => !!p.id);

  return products;
}
