# Markdown Resume Builder

A powerful, AI-enhanced markdown resume editor built for DataAnnotation. This application allows users to create, edit, and export professional resumes while receiving real-time AI suggestions for improvements.

## Project Overview

This application was developed as part of freelance work for DataAnnotation. The entire project was completed in under 3 hours due to client time constraints. It provides a streamlined interface for resume creation and management with the following features:

- Real-time markdown editing and preview
- AI-powered resume improvement suggestions
- Local storage for managing multiple resumes
- PDF export functionality
- Responsive design that works on both desktop and mobile devices

## Technical Implementation

### Project Structure Note

Per client requirements, all application logic is contained within a single file (`App.tsx`). While this is not my preferred architectural approach, it was a specific requirement for this project. In a production environment, I would typically structure the application with proper component separation, custom hooks in separate files, and a more modular architecture.

### Technologies Used

- **React** - Frontend framework
- **TypeScript** - For type safety and enhanced developer experience
- **Tailwind CSS** (via CDN) - For styling
- **OpenAI API** - Powers the AI suggestion feature
- **@uiw/react-md-editor** - Markdown editor component
- **jsPDF** - For PDF export functionality
- **Zod** - For runtime type validation

## Key Technical Highlights

- **Custom Debouncing Logic** - Optimizes API calls and state updates
- **Local Storage Integration** - Persists user data without a backend
- **Responsive Design** - Adapts UI based on device dimensions
- **Accessibility Considerations** - Keyboard navigation and screen reader support
- **Error Handling** - Graceful degradation when API requests fail

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with your API key:
   ```
   REACT_APP_OPENROUTER_API_KEY=your_api_key_here
   ```
4. Start the development server:
   ```
   npm start
   ```

## Build for Production

```
npm run build
```

## Future Improvements

If expanding this project further, I would:

- Implement proper component architecture
- Add unit and integration tests
- Add user authentication
- Create a backend for storing resumes in a database
- Implement additional export formats

---

_This project demonstrates my ability to build complex, interactive React applications according to client specifications, even when working within constraints that differ from standard best practices._
