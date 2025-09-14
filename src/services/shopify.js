// Simple Shopify Storefront API client
// Expects env vars:
//  VITE_SHOPIFY_STORE_DOMAIN (e.g. yourshop.myshopify.com)
//  VITE_SHOPIFY_STOREFRONT_TOKEN (Storefront API public token)
//
// Only public product data is fetched; no checkout mutations here.
const DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
const PRODUCTS_QUERY = `#graphql
query Products($first:Int=$pageSize) {
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
    const endpoint = `https://${DOMAIN}/api/2024-07/graphql.json`;
    const body = JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: limit } });
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': TOKEN,
        },
        body
    });
    if (!res.ok)
        throw new Error('network_' + res.status);
    const json = await res.json();
    if (json.errors)
        throw new Error(json.errors.map(e => e.message).join('; '));
    const products = (json.data?.products.edges || []).map(e => ({
        id: e.node.id,
        handle: e.node.handle,
        title: e.node.title,
        description: e.node.description,
        images: e.node.images.edges.map((ie) => ({ url: ie.node.url, altText: ie.node.altText })),
        variants: e.node.variants.edges.map((ve) => ({ id: ve.node.id, title: ve.node.title, price: ve.node.price })),
    }));
    return products;
}
