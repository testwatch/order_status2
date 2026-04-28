function normalizeOrderNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

function normalizeZip(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function zipMatches(shopifyZip, submittedZip) {
  const saved = normalizeZip(shopifyZip);
  const submitted = normalizeZip(submittedZip);

  if (!saved || !submitted) return false;
  if (saved === submitted) return true;

  // US ZIP+4 support: 100011234 should match 10001, and 10001 should match 100011234.
  if (/^\d+$/.test(saved) && /^\d+$/.test(submitted)) {
    return saved.slice(0, 5) === submitted.slice(0, 5);
  }

  return false;
}

function getTrackingItems(order) {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];

  return fulfillments
    .filter((fulfillment) => fulfillment && fulfillment.tracking_number)
    .map((fulfillment) => ({
      tracking_number: fulfillment.tracking_number,
      tracking_url: fulfillment.tracking_url,
      carrier: fulfillment.tracking_company,
      status: fulfillment.shipment_status || fulfillment.status || null
    }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderNumber, zip } = req.body || {};

    if (!orderNumber || !zip) {
      return res.status(400).json({ error: 'Missing order number or zip code' });
    }

    const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!SHOP || !TOKEN) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const shopifyUrl = `https://${SHOP}/admin/api/2024-01/orders.json?name=${encodeURIComponent(normalizedOrderNumber)}&status=any`;

    const response = await fetch(shopifyUrl, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Unable to fetch order from Shopify' });
    }

    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = data.orders[0];
    const candidateZips = [
      order.shipping_address?.zip,
      order.billing_address?.zip,
      order.customer?.default_address?.zip
    ].filter(Boolean);

    const hasMatchingZip = candidateZips.some((candidateZip) => zipMatches(candidateZip, zip));

    if (!hasMatchingZip) {
      return res.status(403).json({
        error: 'Zip code does not match order',
        debug: process.env.NODE_ENV !== 'production'
          ? {
              submitted_zip_normalized: normalizeZip(zip),
              shopify_zip_normalized_values: candidateZips.map(normalizeZip)
            }
          : undefined
      });
    }

    const trackingItems = getTrackingItems(order);

    if (trackingItems.length === 0) {
      return res.status(200).json({
        found: true,
        status: order.fulfillment_status || 'processing',
        message: 'Order found but not yet fulfilled',
        tracking: []
      });
    }

    return res.status(200).json({
      found: true,
      status: order.fulfillment_status || 'fulfilled',
      tracking: trackingItems,
      tracking_number: trackingItems[0].tracking_number,
      tracking_url: trackingItems[0].tracking_url,
      carrier: trackingItems[0].carrier
    });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
