export const swaggerDocument = {
  openapi: '3.0.3',
  info: {
    title: "QR Ordering & Kitchen System API",
    version: '1.0.0',
    description:
      'Production-grade RESTful API backed by Neon Serverless PostgreSQL for real-time table QR code ordering, kitchen display system (KDS), menu management, and multi-round dining tickets.',
    contact: {
      name: "Cafe Support",
      email: 'support@example.com',
    },
  },
  servers: [
    {
      url: '/api',
      description: 'Local development & API base server',
    },
  ],
  tags: [
    { name: 'Cafe', description: 'Cafe configuration, branding, and billing preferences' },
    { name: 'Tables', description: 'Table management, capacity, and active occupancy tracking' },
    { name: 'Categories', description: 'Menu category organization and ordering' },
    { name: 'Menu', description: 'Menu items, pricing, allergens/veg status, and options' },
    { name: 'Orders', description: 'Real-time ordering, multi-round tracking, and kitchen workflow' },
  ],
  paths: {
    '/cafe': {
      get: {
        tags: ['Cafe'],
        summary: 'Get cafe details and settings',
        description: 'Retrieves current cafe info including taxes, UPI payment ID, logo, and active order acceptance status.',
        responses: {
          '200': {
            description: 'Cafe configuration',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CafeInfo' },
              },
            },
          },
        },
      },
      put: {
        tags: ['Cafe'],
        summary: 'Update cafe settings',
        description: 'Updates cafe name, branding, tax rates, UPI payment ID, and online ordering availability.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CafeInfo' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated cafe configuration',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CafeInfo' },
              },
            },
          },
        },
      },
    },
    '/tables': {
      get: {
        tags: ['Tables'],
        summary: 'Get all restaurant tables',
        description: 'Lists all dining tables with current occupancy status, code, and active order linkage.',
        responses: {
          '200': {
            description: 'List of tables',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TableItem' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Tables'],
        summary: 'Create a new table',
        description: 'Registers a new table with assigned number and seating capacity.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['number'],
                properties: {
                  number: { type: 'string', example: 'Table 09' },
                  capacity: { type: 'integer', example: 4 },
                  status: {
                    type: 'string',
                    enum: ['available', 'occupied', 'reserved'],
                    default: 'available',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created table',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TableItem' },
              },
            },
          },
        },
      },
    },
    '/tables/{id}': {
      patch: {
        tags: ['Tables'],
        summary: 'Update table details or status',
        description: 'Update table occupancy status, seating capacity, or assigned order ID.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'table-01',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['available', 'occupied', 'reserved'] },
                  capacity: { type: 'integer' },
                  number: { type: 'string' },
                  activeOrderId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated table',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TableItem' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Tables'],
        summary: 'Delete a table',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'table-01',
          },
        ],
        responses: {
          '200': {
            description: 'Table deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'Get all categories',
        description: 'Returns menu categories in sorted display order.',
        responses: {
          '200': {
            description: 'List of menu categories',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Category' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Categories'],
        summary: 'Create a new category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Beverages' },
                  icon: { type: 'string', example: 'Coffee' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created category',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Category' },
              },
            },
          },
        },
      },
    },
    '/categories/{id}': {
      put: {
        tags: ['Categories'],
        summary: 'Update category',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'cat-starters',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  icon: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated category',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Category' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Categories'],
        summary: 'Delete category',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'cat-starters',
          },
        ],
        responses: {
          '200': {
            description: 'Category deleted successfully',
          },
        },
      },
    },
    '/menu': {
      get: {
        tags: ['Menu'],
        summary: 'Get all menu items',
        description: 'Returns all food and beverage menu items with pricing, customization options, and availability.',
        responses: {
          '200': {
            description: 'List of menu items',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/MenuItem' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Menu'],
        summary: 'Create a new menu item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MenuItemInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created menu item',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuItem' },
              },
            },
          },
        },
      },
    },
    '/menu/{id}': {
      put: {
        tags: ['Menu'],
        summary: 'Update menu item',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'item-paneer-tikka',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MenuItemInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated menu item',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuItem' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Menu'],
        summary: 'Delete menu item',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'item-paneer-tikka',
          },
        ],
        responses: {
          '200': {
            description: 'Menu item deleted successfully',
          },
        },
      },
    },
    '/menu/{id}/availability': {
      patch: {
        tags: ['Menu'],
        summary: 'Toggle menu item stock availability',
        description: 'Toggles between Available and Sold Out.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'item-cold-coffee',
          },
        ],
        responses: {
          '200': {
            description: 'Updated availability state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { isAvailable: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'Get all orders',
        description: 'Fetches orders with full rounds, item details, timestamps, and payment statuses for Kitchen Display and Admin.',
        responses: {
          '200': {
            description: 'List of orders',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Order' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Orders'],
        summary: 'Place a customer order or add round',
        description: "Places an order from a table QR code. Automatically appends as an extra round to the table's open (unpaid) bill if it has one, so a table keeps a single order id until an admin settles it with Paid. Set force=true to create a distinct ticket instead.",
        parameters: [
          {
            name: 'force',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description: 'Force creation of a new separate order rather than merging into an existing active table round',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created or merged order ticket',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
              },
            },
          },
        },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Update order status',
        description: 'Kitchen workflow status update: received -> preparing -> ready -> served / cancelled.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'ORD-1025',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['received', 'preparing', 'ready', 'served', 'cancelled'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated order ticket',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
              },
            },
          },
        },
      },
    },
    '/orders/{id}/rounds/{roundNumber}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Update status of a specific round',
        description: 'Updates only round N (e.g. appetizers ready before entrees). Automatically recalculates overall aggregate status.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'ORD-1025',
          },
          {
            name: 'roundNumber',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            example: 1,
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['received', 'preparing', 'ready', 'served', 'cancelled'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated order ticket',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
              },
            },
          },
        },
      },
    },
    '/orders/{id}/prep-time': {
      patch: {
        tags: ['Orders'],
        summary: 'Adjust estimated preparation time',
        description: 'Adjusts countdown timer minutes for kitchen rush delays or fast prep.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'ORD-1025',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['additionalOrTotalMinutes'],
                properties: {
                  additionalOrTotalMinutes: { type: 'integer', example: 5 },
                  isAdjustment: { type: 'boolean', default: false },
                  roundNumber: { type: 'integer', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated order ticket',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      CafeInfo: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '7-days' },
          name: { type: 'string', example: '7 Days' },
          tagline: { type: 'string', example: 'Artisanal Brews & Gourmet Kitchen' },
          logo: { type: 'string' },
          address: { type: 'string' },
          phone: { type: 'string' },
          currency: { type: 'string', example: '₹' },
          taxPercent: { type: 'number', example: 5 },
          serviceChargePercent: { type: 'number', example: 0 },
          isAcceptingOrders: { type: 'boolean', example: true },
          upiId: { type: 'string', example: 'royalcafe@upi' },
        },
      },
      TableItem: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'table-01' },
          number: { type: 'string', example: 'Table 01' },
          code: { type: 'string', example: 'table-01' },
          capacity: { type: 'integer', example: 4 },
          status: { type: 'string', enum: ['available', 'occupied', 'reserved'] },
          activeOrderId: { type: 'string', nullable: true },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'cat-starters' },
          name: { type: 'string', example: 'Starters' },
          icon: { type: 'string', example: 'Sparkles' },
          displayOrder: { type: 'integer', example: 1 },
        },
      },
      MenuItem: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'item-paneer-tikka' },
          name: { type: 'string', example: 'Paneer Tikka' },
          description: { type: 'string' },
          price: { type: 'number', example: 220 },
          categoryId: { type: 'string', example: 'cat-starters' },
          vegType: { type: 'string', enum: ['veg', 'non-veg'] },
          image: { type: 'string' },
          isAvailable: { type: 'boolean', example: true },
          preparationTimeMin: { type: 'integer', example: 15 },
          customizationGroups: {
            type: 'array',
            items: { $ref: '#/components/schemas/CustomizationGroup' },
          },
        },
      },
      MenuItemInput: {
        type: 'object',
        required: ['name', 'price', 'vegType', 'categoryId'],
        properties: {
          name: { type: 'string', example: 'Crispy Sweet Corn' },
          description: { type: 'string' },
          price: { type: 'number', example: 180 },
          categoryId: { type: 'string', example: 'cat-starters' },
          vegType: { type: 'string', enum: ['veg', 'non-veg'] },
          image: { type: 'string' },
          isAvailable: { type: 'boolean', default: true },
          preparationTimeMin: { type: 'integer', default: 15 },
          customizationGroups: {
            type: 'array',
            items: { $ref: '#/components/schemas/CustomizationGroup' },
          },
        },
      },
      CustomizationGroup: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'cust-spice' },
          title: { type: 'string', example: 'Spice Level' },
          required: { type: 'boolean', example: true },
          type: { type: 'string', enum: ['radio', 'checkbox'] },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
        },
      },
      CartItem: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          menuItemId: { type: 'string' },
          name: { type: 'string' },
          price: { type: 'number' },
          vegType: { type: 'string', enum: ['veg', 'non-veg'] },
          quantity: { type: 'integer', example: 1 },
          itemTotal: { type: 'number', example: 220 },
          preparationTimeMin: { type: 'integer' },
          selectedCustomizations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                groupTitle: { type: 'string' },
                optionName: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
          specialInstructions: { type: 'string', nullable: true },
        },
      },
      OrderRound: {
        type: 'object',
        properties: {
          roundNumber: { type: 'integer', example: 1 },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/CartItem' },
          },
          placedAt: { type: 'number' },
          estimatedPrepTimeMin: { type: 'integer', example: 15 },
          preparingStartedAt: { type: 'number', nullable: true },
          readyAt: { type: 'number', nullable: true },
          status: { type: 'string', enum: ['received', 'preparing', 'ready', 'served', 'cancelled'] },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'ORD-1025' },
          cafeId: { type: 'string', example: '7-days' },
          tableId: { type: 'string', example: 'table-05' },
          tableNumber: { type: 'string', example: 'Table 05' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/CartItem' },
          },
          subtotal: { type: 'number', example: 420 },
          tax: { type: 'number', example: 0 },
          serviceCharge: { type: 'number', example: 0 },
          total: { type: 'number', example: 420 },
          status: { type: 'string', enum: ['received', 'preparing', 'ready', 'served', 'cancelled'] },
          customerName: { type: 'string', nullable: true },
          customerPhone: { type: 'string', nullable: true },
          specialInstructions: { type: 'string', nullable: true },
          paymentMethod: { type: 'string', enum: ['counter_cash', 'counter_card', 'counter_upi'] },
          paymentStatus: { type: 'string', enum: ['pending', 'paid'] },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
          orderRounds: { type: 'integer', example: 1 },
          isMerged: { type: 'boolean', example: false },
          rounds: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderRound' },
          },
        },
      },
      OrderInput: {
        type: 'object',
        required: ['tableId', 'tableNumber', 'items', 'subtotal', 'total'],
        properties: {
          tableId: { type: 'string', example: 'table-05' },
          tableNumber: { type: 'string', example: 'Table 05' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/CartItem' },
          },
          subtotal: { type: 'number', example: 420 },
          tax: { type: 'number', default: 0 },
          serviceCharge: { type: 'number', default: 0 },
          total: { type: 'number', example: 420 },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          specialInstructions: { type: 'string' },
          paymentMethod: { type: 'string', default: 'counter_cash' },
          paymentStatus: { type: 'string', default: 'pending' },
        },
      },
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-KEY',
        description: 'Authentication Swagger API key (Key: 50d904c2-f8ef-48bd-a3b8-4d8d7b27358b)',
      },
    },
  },
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
};
