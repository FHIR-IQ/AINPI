# ProviderCard Frontend

Next.js 14 frontend application for the ProviderCard FHIR-based provider management system.

## Features

- **Provider Login & Registration**: JWT-based authentication
- **Profile Management**: Edit provider information, specialty, practice details, licenses
- **Insurance Management**: Add and manage accepted insurances
- **Sync to External Systems**: One-click sync to payers and state boards
- **Audit Log**: View complete history of sync events
- **Profile Completeness**: Real-time calculation of profile completeness
- **Responsive Design**: Mobile-friendly UI with Tailwind CSS

## Quick Start

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.local.example .env.local

# Update .env.local with your API URL
# NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Development

```bash
# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
# Create production build
npm run build

# Start production server
npm start
```

## Pages

### `/` - Home
Redirects to dashboard if logged in, otherwise to login page.

### `/login` - Login/Register
- Login with email and password
- Register new provider account with NPI

### `/dashboard` - Provider Profile
- Edit personal information (name, NPI, phone, address)
- Manage specialty and practice information
- Configure license details
- Add/remove accepted insurances
- Save profile changes
- Trigger sync to external systems
- View profile completeness score

### `/audit-log` - Sync Audit Log
- View all sync events
- See success/failure status
- Monitor sync performance
- Filter by status

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios
- **Icons**: Lucide React
- **Date Handling**: date-fns

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import repository in Vercel
3. Set environment variable:
   - `NEXT_PUBLIC_API_URL`: Your backend API URL
4. Deploy

The app will automatically deploy on every push to main branch.

### Manual Deployment

```bash
# Build
npm run build

# Deploy .next directory to your hosting provider
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:8000` |

## Project Structure

```
frontend/
├── src/
│   ├── app/              # Next.js app router pages
│   │   ├── page.tsx      # Home (redirect)
│   │   ├── login/        # Login/register page
│   │   ├── dashboard/    # Profile management
│   │   └── audit-log/    # Sync audit log
│   ├── components/       # Reusable components
│   │   └── Navbar.tsx
│   └── lib/              # Utilities and API client
│       └── api.ts        # Axios API client
├── public/               # Static assets
└── package.json
```

## Development Tips

### API Client

The API client (`src/lib/api.ts`) automatically:
- Adds JWT token to all authenticated requests
- Redirects to login on 401 errors
- Handles request/response errors

### Adding New API Endpoints

```typescript
// In src/lib/api.ts
export const myNewEndpoint = async (): Promise<MyType> => {
  const response = await api.get('/api/my-endpoint');
  return response.data;
};
```

### Styling

Use Tailwind utility classes. Common custom classes defined in `globals.css`:
- `.btn-primary` - Primary button
- `.btn-secondary` - Secondary button
- `.input-field` - Form input
- `.card` - Card container
- `.label` - Form label

## Testing

```bash
# Run linter
npm run lint
```

## License

Proprietary - Copyright © 2025 fhiriq
