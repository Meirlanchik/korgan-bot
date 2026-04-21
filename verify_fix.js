import { parseAndStoreProductData, runDbAutoPricingForSku } from './src/autoPricing.js';
import { initDatabase, getProduct } from './src/db.js';
import Database from 'better-sqlite3';

async function verify() {
  const dbPath = './data/kaspi.db';
  initDatabase(dbPath);
  const db = new Database(dbPath);

  try {
    const product = db.prepare('SELECT sku FROM products WHERE sku IS NOT NULL LIMIT 1').get();
    if (!product) {
      console.error('No product found in DB');
      return;
    }
    const sku = product.sku;
    const ownMerchantId = '30452124';

    const mockResult = {
      title: 'Verified Product',
      brand: 'Verified Brand',
      category: 'Verified Category',
      vertical_category: 'Verified Vertical',
      master_category: 'Verified Master',
      images: ['http://example.com/img1.jpg', 'http://example.com/img2.jpg'],
      shopLink: 'https://kaspi.kz/shop/p/verified-id',
      kaspiId: 'verified-id',
      price: 60000,
      sellers: [
        { merchantId: 'comp-1', merchantName: 'Competitor', price: 58000, merchantRating: 5, merchantReviewsQuantity: 100, deliveryType: 'Delivery', kaspiDelivery: 1 },
        { merchantId: ownMerchantId, merchantName: 'My Shop', price: 60000, merchantRating: 5, merchantReviewsQuantity: 50, deliveryType: 'Pickup', kaspiDelivery: 0 }
      ]
    };

    console.log('--- Step 1: parseAndStoreProductData ---');
    await parseAndStoreProductData({
      sku,
      parser: async () => mockResult,
      ownMerchantId
    });

    const updated = getProduct(sku);
    console.log('Brand:', updated.brand);
    console.log('Category:', updated.category);
    let images = [];
    try { images = JSON.parse(updated.images || "[]"); } catch(e) {}
    console.log('Images Length:', images.length);
    console.log('Shop Link:', updated.shop_link);
    console.log('My Position:', updated.my_position);
    console.log('Seller Count:', updated.seller_count);
    console.log('First Place Price:', updated.first_place_price);
    console.log('Last Kaspi Price:', updated.last_kaspi_price);

    console.log('\n--- Step 2: runDbAutoPricingForSku ---');
    // Ensure product has auto pricing enabled for the test
    db.prepare('UPDATE products SET auto_pricing_enabled = 1, min_price = 50000, max_price = 70000 WHERE sku = ?').run(sku);
    
    const pricingResult = await runDbAutoPricingForSku({ 
        sku, 
        parser: async () => mockResult,
        ownMerchantId 
    });
    
    if (pricingResult) {
        console.log('Old Price:', pricingResult.oldPrice);
        console.log('New Price:', pricingResult.newPrice);
        console.log('Competitor Price:', pricingResult.competitorPrice);
        console.log('Reason:', pricingResult.reason);
    } else {
        console.log('No pricing update triggered.');
    }

  } catch (err) {
    console.error('Runtime Error:', err);
  } finally {
    db.close();
  }
}

verify();
