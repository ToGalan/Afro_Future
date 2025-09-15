// Shopify Storefront API client using @shopify/storefront-api-client
// Expects env vars:
//  VITE_SHOPIFY_STORE_DOMAIN (e.g. yourshop.myshopify.com)
//  VITE_SHOPIFY_STOREFRONT_TOKEN (Storefront API public token)
// Only public product data is fetched; no checkout mutations here.
// Using a minimal fetch-based Storefront client to reduce preflight/CORS issues

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
const API_BASE = (import.meta as any)?.env?.VITE_API_BASE || '';
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
  // Prefer server proxy when API_BASE is configured to avoid browser CORS issues
  if (API_BASE) {
    try {
      const r = await fetch(`${API_BASE.replace(/\/$/,'')}/storefront/products?limit=${encodeURIComponent(String(limit))}`);
      if (r.ok) {
        const json = await r.json();
        if (json?.ok && Array.isArray(json.products)) {
          return json.products as ShopifyProduct[];
        }
      } else if (DEBUG) {
        const text = await r.text().catch(()=> '');
        // eslint-disable-next-line no-console
        console.warn('[storefront-proxy] non-OK', r.status, text?.slice(0,200));
      }
      // If proxy returns 501 (not configured) or fails, fall through to direct fetch
    } catch (e) {
      if (DEBUG) console.warn('[storefront-proxy] failed', e);
    }
  }
  const endpoint = `https://${DOMAIN}/api/${API_VERSION}/graphql.json`;
  let data: any; let errors: any;
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': String(TOKEN),
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: limit } })
    });
    if (!r.ok) {
      const text = await r.text().catch(()=> '');
      const hint = r.status === 401 ? ' (check Storefront token and store domain)' : '';
      throw new Error(`HTTP ${r.status} ${r.statusText}${hint} • ${text?.slice(0,200)}`);
    }
    const json = await r.json().catch(()=> ({}));
    data = json.data; errors = json.errors;
  } catch (e:any) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error('Storefront fetch failed', { endpoint, domain: DOMAIN, apiVersion: API_VERSION, tokenPrefix: String(TOKEN).slice(0,4)+'…', error: e });
    }
    const domainTip = IS_MYSHOPIFY ? '' : ' If using a custom domain, set VITE_SHOPIFY_STORE_DOMAIN to your <shop>.myshopify.com domain.';
    throw new Error(`Shopify Storefront: ${e?.message || e}${domainTip}`);
  }
  const errs = Array.isArray(errors) ? errors : (errors ? [errors as any] : []);
  if (errs.length) {
    if (DEBUG) {
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
