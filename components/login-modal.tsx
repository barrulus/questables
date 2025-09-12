import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Card, CardContent } from "./ui/card";
import { toast } from "sonner@2.0.3";
import { Eye, EyeOff, Mail, Lock, User, Crown, Shield } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: (user: { id: string; username: string; email: string; role: "player" | "dm" | "admin" }) => void;
  onSwitchToRegister: () => void;
}

export function LoginModal({ open, onOpenChange, onLogin, onSwitchToRegister }: LoginModalProps) {
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Demo accounts
  const demoAccounts = [
    {
      id: "player1",
      username: "Frodo Baggins",
      email: "frodo@shire.com",
      password: "demo123",
      role: "player" as const,
      description: "Experience the app as a player"
    },
    {
      id: "dm1",
      username: "Gandalf Grey",
      email: "gandalf@fellowship.com",
      password: "demo123",
      role: "dm" as const,
      description: "Manage campaigns as a Dungeon Master"
    },
    {
      id: "admin1",
      username: "System Admin",
      email: "admin@dndapp.com",
      password: "demo123",
      role: "admin" as const,
      description: "Full system administration access"
    }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check demo accounts
    const account = demoAccounts.find(acc => 
      acc.email === formData.email && acc.password === formData.password
    );

    if (account) {
      onLogin({
        id: account.id,
        username: account.username,
        email: account.email,
        role: account.role
      });
      toast.success(`Welcome back, ${account.username}!`);
      onOpenChange(false);
    } else {
      toast.error("Invalid email or password. Try a demo account!");
    }

    setIsLoading(false);
  };

  const handleDemoLogin = (account: typeof demoAccounts[0]) => {
    onLogin({
      id: account.id,
      username: account.username,
      email: account.email,
      role: account.role
    });
    toast.success(`Logged in as ${account.username}!`);
    onOpenChange(false);
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "player": return <User className="w-4 h-4" />;
      case "dm": return <Shield className="w-4 h-4" />;
      case "admin": return <Crown className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "player": return "border-l-blue-500";
      case "dm": return "border-l-purple-500";
      case "admin": return "border-l-amber-500";
      default: return "border-l-gray-500";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl">Welcome Back</DialogTitle>
          <DialogDescription>
            Sign in to your account to continue your adventures
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter your email"
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter your password"
                  className="pl-10 pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="flex items-center justify-between mt-4">
            <Button variant="link" className="p-0 h-auto text-sm text-muted-foreground">
              Forgot password?
            </Button>
          </div>

          <Separator className="my-6" />

          <div className="space-y-3">
            <h4 className="font-medium text-center text-sm text-muted-foreground">
              Try Demo Accounts
            </h4>
            
            {demoAccounts.map((account) => (
              <Card 
                key={account.id} 
                className={`cursor-pointer transition-colors hover:bg-muted/50 border-l-4 ${getRoleColor(account.role)}`}
                onClick={() => handleDemoLogin(account)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getRoleIcon(account.role)}
                      <div>
                        <div className="font-medium text-sm">{account.username}</div>
                        <div className="text-xs text-muted-foreground">{account.description}</div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground capitalize bg-muted px-2 py-1 rounded">
                      {account.role}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator className="my-6" />

          <div className="text-center">
            <span className="text-sm text-muted-foreground">Don't have an account? </span>
            <Button
              variant="link"
              className="p-0 h-auto text-sm"
              onClick={onSwitchToRegister}
            >
              Sign up
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}