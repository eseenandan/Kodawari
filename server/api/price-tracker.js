/**
 * Price Tracker API Endpoint
 * 
 * This endpoint fetches historical transaction data (sold items) from Sharetribe
 * and returns price information for items matching the given filters.
 * 
 * Query Parameters:
 * - keyword: (string, optional) Search by item title or description
 * - category: (string, optional) Filter by category
 * - page: (number, optional) Page number for pagination (default: 1)
 * - perPage: (number, optional) Items per page (default: 20)
 * - sortBy: (string, optional) Sort by 'price' or 'date' (default: 'date')
 * - sortOrder: (string, optional) 'asc' or 'desc' (default: 'desc')
 */

const { getTrustedSdk, handleError } = require('../api-util/sdk');

module.exports = (req, res) => {
  const { keyword = '', category = '', page = 1, perPage = 20, sortBy = 'date', sortOrder = 'desc' } = req.query;

  getTrustedSdk(req)
    .then(sdk => {
      // Build query parameters for the Integration API
      const queryParams = {
        states: ['state/completed', 'state/delivered'],
        perPage: Math.min(parseInt(perPage, 10) || 20, 100), // Cap at 100 items per page
        page: Math.max(parseInt(page, 10) || 1, 1),
      };

      // Query transactions using the Integration API
      return sdk.transactions.query(queryParams);
    })
    .then(response => {
      const transactions = response.data.data || [];
      const meta = response.data.meta || {};

      // Process transactions to extract price information
      const priceData = transactions
        .map(transaction => {
          const listing = transaction.relationships?.listing?.data;
          const lineItems = transaction.attributes?.lineItems || [];
          
          // Find the main line item (usually the first one that's not a commission)
          const mainLineItem = lineItems.find(item => !item.code.includes('commission'));
          
          if (!mainLineItem || !listing) {
            return null;
          }

          const listingTitle = listing.attributes?.title || 'Unknown Item';
          const listingCategory = listing.attributes?.publicData?.category || '';
          const price = mainLineItem.lineTotal?.amount || 0;
          const currency = mainLineItem.lineTotal?.currency || 'USD';
          const soldDate = transaction.attributes?.lastTransitionedAt || transaction.attributes?.createdAt;

          return {
            id: transaction.id.uuid,
            listingId: listing.id.uuid,
            title: listingTitle,
            category: listingCategory,
            price: price / 100, // Convert from cents to dollars
            currency,
            soldDate,
            transactionId: transaction.id.uuid,
          };
        })
        .filter(item => item !== null);

      // Filter by keyword if provided
      let filteredData = priceData;
      if (keyword.trim()) {
        const lowerKeyword = keyword.toLowerCase();
        filteredData = priceData.filter(
          item =>
            item.title.toLowerCase().includes(lowerKeyword) ||
            item.category.toLowerCase().includes(lowerKeyword)
        );
      }

      // Filter by category if provided
      if (category.trim()) {
        filteredData = filteredData.filter(item => item.category === category);
      }

      // Sort the results
      filteredData.sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'price') {
          comparison = a.price - b.price;
        } else {
          // Default to date sorting
          comparison = new Date(a.soldDate) - new Date(b.soldDate);
        }
        return sortOrder === 'desc' ? -comparison : comparison;
      });

      // Return the processed data with metadata
      res
        .status(200)
        .set('Content-Type', 'application/json')
        .json({
          data: filteredData,
          meta: {
            totalItems: filteredData.length,
            page: parseInt(page, 10) || 1,
            perPage: parseInt(perPage, 10) || 20,
            totalPages: Math.ceil(filteredData.length / (parseInt(perPage, 10) || 20)),
            originalMeta: meta,
          },
        })
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
