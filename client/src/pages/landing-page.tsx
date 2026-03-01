import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail } from "lucide-react";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";
interface LandingPageProps {
  onLogin?: () => void;
}

export default function LandingPage({ onLogin }: LandingPageProps) {
  const handleGoogleLogin = async () => {
    // Now using real Google OAuth since redirect URI is configured
    window.location.href = '/api/auth/google';
  };

  const handleMicrosoftLogin = () => {
    // Redirect to Microsoft OAuth  
    window.location.href = '/api/auth/microsoft';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header Section */}
          <div className="text-center mb-16">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-blue-600 dark:bg-blue-500 p-4 rounded-full">
                <Mail className="h-8 w-8 text-white" />
              </div>
            </div>
            
            <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-6">
              Welcome aboard
            </h1>
            <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-6">
              AImailagent
            </h2>
            
            <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
              Send personalized emails, follow-up easily and track your campaigns in real-time.
            </p>
          </div>

          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Column - Authentication */}
            <div className="space-y-6">
              <Card className="p-8 shadow-lg border-0 bg-white dark:bg-gray-800">
                <CardContent className="space-y-6 p-0">
                  <div className="space-y-4">
                    <Button
                      onClick={handleGoogleLogin}
                      variant="default"
                      size="lg"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 text-lg font-medium"
                      data-testid="button-google-login"
                    >
                      <FaGoogle className="mr-3 h-5 w-5" />
                      Continue with Google
                    </Button>
                    
                    <Button
                      onClick={handleMicrosoftLogin}
                      variant="default"
                      size="lg"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 text-lg font-medium"
                      data-testid="button-microsoft-login"
                    >
                      <FaMicrosoft className="mr-3 h-5 w-5" />
                      Continue with Microsoft
                    </Button>
                  </div>
                  
                  <div className="text-center">
                    <a href="#" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
                      Create an account - Use a magic link
                    </a>
                  </div>
                </CardContent>
              </Card>
              
              <div className="text-center text-sm text-gray-500 dark:text-gray-400">
                © 2024 AImailagent - Terms - Security - Help
              </div>
            </div>

            {/* Right Column - Features */}
            <div className="bg-blue-600 dark:bg-blue-700 rounded-2xl p-8 text-white">
              <div className="space-y-8">
                <div>
                  <h3 className="text-2xl font-bold mb-4">
                    The #1 Emailing Platform for Gmail
                  </h3>
                  
                  <div className="grid grid-cols-3 gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium">Spotify</div>
                      <div className="opacity-80">Stanford</div>
                      <div className="opacity-80">Pinterest</div>
                      <div className="opacity-80">Waitrose</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">change.org</div>
                      <div className="opacity-80">Byte Dance</div>
                      <div className="opacity-80">Shopify</div>
                      <div className="opacity-80">headspace</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">Optimizely</div>
                      <div className="opacity-80">The Telegraph</div>
                      <div className="opacity-80">VentureBeat</div>
                      <div className="opacity-80">Uber</div>
                    </div>
                  </div>
                </div>
                
                <div className="text-center">
                  <div className="flex justify-center mb-2">
                    {'★★★★★'.split('').map((star, i) => (
                      <span key={i} className="text-yellow-400 text-lg">{star}</span>
                    ))}
                  </div>
                  <p className="text-sm opacity-90">
                    Rated 4.9/5 out of 10000 reviews
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}