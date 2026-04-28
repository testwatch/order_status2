export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderNumber, zip } = req.body;

    if (!orderNumber || !zip) {
      return res.status(400).json({ error: 'Missing order number or zip code' });
    }

    const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    const response = await fetch(`https://${SHOP}/admin/api/2024-01/orders.json?name=${orderNumber}&status=any`, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = data.orders[0];

    const shippingZip = order.shipping_address?.zip || order.billing_address?.zip;

    if (!shippingZip || shippingZip.toLowerCase() !== zip.toLowerCase()) {
      return res.status(403).json({ error: 'Zip code does not match order' });
    }

    const fulfillment = order.fulfillments?.[0];

    if (!fulfillment) {
      return res.status(200).json({
        status: order.fulfillment_status || 'Processing',
        message: 'Order found but not yet fulfilled'
      });
    }

    return res.status(200).json({
      status: order.fulfillment_status,
      tracking_number: fulfillment.tracking_number,
      tracking_url: fulfillment.tracking_url,
      carrier: fulfillment.tracking_company
    });

  } catch (error) {
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
