// Shopify Storefront API client using @shopify/storefront-api-client
// Expects env vars:
//  VITE_SHOPIFY_STORE_DOMAIN (e.g. yourshop.myshopify.com)
//  VITE_SHOPIFY_STOREFRONT_TOKEN (Storefront API public token)
// Only public product data is fetched; no checkout mutations here.
import { createStorefrontApiClient } from '@shopify/storefront-api-client';
const DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || 'store.afro-future.app';
const TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
const API_VERSION = import.meta?.env?.VITE_SHOPIFY_STOREFRONT_API_VERSION || '2025-07';
// DEBUG flag for verbose client errors
const DEBUG = import.meta?.env?.VITE_SHOPIFY_DEBUG === 'true';
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
export async function fetchProducts(limit = 12) {
    if (!DOMAIN || !TOKEN)
        throw new Error('missing_shopify_env');
    // Guard against using an Admin token on the Storefront API; admin tokens start with 'shpat_'
    if (typeof TOKEN === 'string' && TOKEN.startsWith('shpat_')) {
        throw new Error('Invalid token for Storefront API: received an Admin token (shpat_...). Please use a Storefront public access token instead.');
    }
    const client = createStorefrontApiClient({ storeDomain: DOMAIN, apiVersion: API_VERSION, publicAccessToken: TOKEN });
    let resp;
    try {
        resp = await client.request(PRODUCTS_QUERY, { variables: { first: limit } });
    }
    catch (e) {
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
    const { data, errors } = resp ?? {};
    const errs = Array.isArray(errors) ? errors : (errors ? [errors] : []);
    if (errs.length) {
        if (DEBUG) {
            const endpoint = `https://${DOMAIN}/api/${API_VERSION}/graphql.json`;
            // eslint-disable-next-line no-console
            console.error('Shopify Storefront GraphQL errors', {
                endpoint,
                domain: DOMAIN,
                messages: errs.map((e) => e?.message ?? String(e)),
                variables: { first: limit },
            });
        }
        throw new Error(errs.map((e) => e?.message ?? String(e)).join('; '));
    }
    const edges = Array.isArray(data?.products?.edges) ? data.products.edges : [];
    const products = edges.map((e) => {
        const node = e?.node ?? {};
        const imageEdges = Array.isArray(node?.images?.edges) ? node.images.edges : [];
        const variantEdges = Array.isArray(node?.variants?.edges) ? node.variants.edges : [];
        const images = imageEdges
            .map((ie) => ({ url: ie?.node?.url ?? '', altText: ie?.node?.altText }))
            .filter((img) => !!img.url);
        const variants = variantEdges
            .map((ve) => ({
            id: String(ve?.node?.id ?? ''),
            title: ve?.node?.title ?? '',
            price: {
                amount: String(ve?.node?.price?.amount ?? ''),
                currencyCode: ve?.node?.price?.currencyCode ?? ''
            }
        }))
            .filter((v) => !!v.id);
        return {
            id: String(node?.id ?? ''),
            handle: node?.handle ?? '',
            title: node?.title ?? '',
            description: node?.description ?? '',
            images,
            variants,
        };
    }).filter((p) => !!p.id);
    return products;
}
