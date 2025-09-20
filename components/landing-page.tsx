import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { LoginModal } from "./login-modal";
import { RegisterModal } from "./register-modal";
import { Dice6, Shield, Users, Sword, BookOpen, MapIcon, Sparkles } from "lucide-react";

interface LandingPageProps {
  onLogin: () => void;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Image with Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-30"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1713993646583-584a29476476?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmYW50YXN5JTIwbWVkaWV2YWwlMjB0YXZlcm4lMjBpbnRlcmlvcnxlbnwxfHx8fDE3NTc2NzA1Mjl8MA&ixlib=rb-4.1.0&q=80&w=1080')`
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/50 via-purple-900/30 to-black/60" />
      
      {/* Animated Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-purple-400 rounded-full animate-pulse opacity-60" />
        <div className="absolute top-3/4 right-1/4 w-1 h-1 bg-blue-400 rounded-full animate-pulse opacity-40" />
        <div className="absolute top-1/2 left-1/6 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse opacity-50" />
        <div className="absolute bottom-1/4 right-1/3 w-2 h-2 bg-green-400 rounded-full animate-pulse opacity-30" />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-600 rounded-lg flex items-center justify-center">
                <Dice6 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">D&D Campaign Manager</h1>
                <p className="text-sm text-gray-300">Epic adventures await</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => setShowLogin(true)}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                Login
              </Button>
              <Button 
                onClick={() => setShowRegister(true)}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white border-0"
              >
                Get Started
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-6xl mx-auto text-center">
            {/* Hero Section */}
            <div className="mb-16">
              <div className="inline-flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 rounded-full px-4 py-2 mb-6">
                <Sparkles className="w-4 h-4 text-purple-300" />
                <span className="text-sm text-purple-200">The ultimate D&D companion</span>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
                Master Your
                <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent"> Adventures</span>
              </h1>
              
              <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
                Organize campaigns, manage characters, track combat, and bring your D&D sessions to life 
                with our comprehensive digital toolset designed for players and dungeon masters.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  size="lg"
                  onClick={() => setShowRegister(true)}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white border-0 px-8 py-3"
                >
                  Start Your Adventure
                </Button>
                <Button 
                  size="lg"
                  variant="outline"
                  onClick={() => setShowLogin(true)}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20 px-8 py-3"
                >
                  Continue Playing
                </Button>
              </div>
            </div>

            {/* Features Grid */}
            <div className="grid md:grid-cols-3 gap-8 mb-16">
              <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
                <CardHeader className="text-center">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                  <CardTitle className="text-white">For Players</CardTitle>
                  <CardDescription className="text-gray-300">
                    Manage characters, track stats, and join epic campaigns
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-gray-400 space-y-2">
                    <li>• Character sheet management</li>
                    <li>• Inventory & spell tracking</li>
                    <li>• Campaign participation</li>
                    <li>• Digital dice rolling</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
                <CardHeader className="text-center">
                  <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-6 h-6 text-purple-400" />
                  </div>
                  <CardTitle className="text-white">For Dungeon Masters</CardTitle>
                  <CardDescription className="text-gray-300">
                    Create campaigns, manage NPCs, and orchestrate adventures
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-gray-400 space-y-2">
                    <li>• Campaign creation & management</li>
                    <li>• NPC & location tracking</li>
                    <li>• Interactive maps & markers</li>
                    <li>• Combat & encounter tools</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
                <CardHeader className="text-center">
                  <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Sword className="w-6 h-6 text-amber-400" />
                  </div>
                  <CardTitle className="text-white">Enhanced Gameplay</CardTitle>
                  <CardDescription className="text-gray-300">
                    Immersive tools that bring your table to life
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-gray-400 space-y-2">
                    <li>• Real-time chat & communication</li>
                    <li>• Interactive world maps</li>
                    <li>• Rule books & compendiums</li>
                    <li>• Session notes & journals</li>
                  </ul>
                </CardContent>
              </Card>
            </div>



            {/* Call to Action */}
            <div className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded-2xl p-8">
              <h3 className="text-2xl font-bold text-white mb-4">Ready to Begin Your Quest?</h3>
              <p className="text-gray-300 mb-6">
                Join thousands of adventurers already using our platform to create unforgettable D&D experiences.
              </p>
              <Button 
                size="lg"
                onClick={() => setShowRegister(true)}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white border-0 px-8 py-3"
              >
                Create Your Account
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="text-sm text-gray-400">
              © 2024 D&D Campaign Manager. Built for adventurers by adventurers.
            </div>
            <div className="flex gap-6 text-sm text-gray-400">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <LoginModal 
        open={showLogin} 
        onOpenChange={setShowLogin}
        onLogin={onLogin}
        onSwitchToRegister={() => {
          setShowLogin(false);
          setShowRegister(true);
        }}
      />
      <RegisterModal 
        open={showRegister} 
        onOpenChange={setShowRegister}
        onRegister={onLogin}
        onSwitchToLogin={() => {
          setShowRegister(false);
          setShowLogin(true);
        }}
      />
    </div>
  );
}
